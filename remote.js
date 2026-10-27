/**
 * Remote workspaces.
 *
 * A workspace whose files live on another machine is mounted as a local mirror:
 * `.dsh-workspace.json` records the remote path and the host id, and everything
 * the panel writes goes into that mirror. The work itself happens on the remote
 * host, so a verification command has to run there too — `test -f` against a
 * mirror that only holds the documents the panel wrote is not a check.
 *
 * The connection facts come from the same files the workspace feature uses:
 * the mirror's own marker for the remote path, the host vault for the address.
 * `ssh` is the client everyone already has; no credential is read or copied.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** How long one remote command may take before it is killed. */
const REMOTE_TIMEOUT_MS = 120_000;
/** `ssh` exits with this when the connection itself failed. */
const SSH_CONNECTION_FAILED = 255;
/**
 * @returns {string} the harness home holding the workspace vault.
 */
function harnessHome() {
    const configured = process.env.DSH_HOME;
    return configured === undefined || configured.trim() === '' ? join(homedir(), '.dsh') : configured;
}
/**
 * @param {string} path - candidate private key.
 * @returns {boolean} true when the key file exists.
 */
function isFile(path) {
    try {
        return statSync(path).isFile();
    }
    catch {
        return false;
    }
}
/**
 * Read the mirror marker of a workspace directory.
 * @param {string} root - workspace directory as the task stores it.
 * @returns {{ hostId: string; remotePath: string } | null} the marker, if any.
 */
export function readMirrorMarker(root) {
    try {
        const raw = readFileSync(join(root, '.dsh-workspace.json'), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object')
            return null;
        const record = parsed;
        if (record.kind !== 'dsh-workspace/remote')
            return null;
        const hostId = typeof record.hostId === 'string' ? record.hostId : '';
        const remotePath = typeof record.remotePath === 'string' ? record.remotePath : '';
        if (hostId === '' || remotePath === '')
            return null;
        return { hostId, remotePath };
    }
    catch {
        return null;
    }
}
/**
 * Look a host up in the workspace vault.
 * @param {string} hostId - id recorded by the mirror.
 * @returns {{ host: string; port: number; user: string; keyPath: string | null } | null} connection facts.
 */
export function readVaultHost(hostId) {
    try {
        const raw = readFileSync(join(harnessHome(), 'workspaces', 'vault.json'), 'utf8');
        const parsed = JSON.parse(raw);
        const host = parsed.hosts?.[hostId];
        if (host === undefined)
            return null;
        const name = typeof host.hostname === 'string' ? host.hostname : '';
        const user = typeof host.username === 'string' ? host.username : '';
        const port = typeof host.port === 'number' ? host.port : 22;
        if (name === '' || user === '')
            return null;
        const auth = host.auth;
        const keyPath = auth !== undefined && auth.kind === 'keyPath' && typeof auth.keyPath === 'string' ? auth.keyPath : null;
        return { host: name, port, user, keyPath };
    }
    catch {
        return null;
    }
}
/**
 * @param {string} root - workspace directory.
 * @returns {RemoteTarget | null} the remote target, or null for a local workspace.
 */
export function resolveRemote(root) {
    if (root.trim() === '')
        return null;
    const marker = readMirrorMarker(root);
    if (marker === null)
        return null;
    const host = readVaultHost(marker.hostId);
    if (host === null)
        return null;
    return {
        host: host.host,
        port: host.port,
        user: host.user,
        keyPath: host.keyPath,
        remotePath: marker.remotePath,
        localPath: root,
    };
}
/**
 * Quote one path for a POSIX shell.
 * @param {string} value - the literal value.
 * @returns {string} the quoted form.
 */
export function shellQuote(value) {
    return "'" + value.split("'").join("'\\''") + "'";
}
/**
 * Where a locally written path lives on the host that owns the workspace.
 *
 * A workspace is mirrored locally as a root directory, so anything under that
 * root is a suffix of it: the same place is the workspace's remote path followed
 * by that suffix. A worktree created by the task lives under the mirror and maps
 * the same way, which is why this is the only conversion the runner needs. A
 * path outside the mirror is already absolute on that host and only needs its
 * separators normalised.
 * @param {string} localRoot - local path of the workspace, '' when unknown.
 * @param {string} remoteRoot - the same directory on its host.
 * @param {string} dir - the path to translate.
 * @returns {string} the path to use over ssh.
 */
export function mapToRemotePath(localRoot, remoteRoot, dir) {
    const base = remoteRoot.replace(/[\\/]+$/, '');
    const local = (localRoot ?? '').replace(/[\\/]+$/, '');
    if (dir === '' || (local !== '' && dir === local))
        return base;
    const inside = local !== '' && (dir.startsWith(local + '/') || dir.startsWith(local + '\\') || dir.startsWith(base + '/'));
    if (inside) {
        const rest = dir
            .slice(dir.startsWith(base + '/') ? base.length : local.length)
            .split(/[\\/]+/)
            .filter(part => part !== '')
            .join('/');
        return rest === '' ? base : base + '/' + rest;
    }
    const normalised = dir.split(/[\\/]+/).filter(part => part !== '').join('/');
    return dir.startsWith('/') ? '/' + normalised : normalised;
}
/**
 * @returns {string} the ssh client to use.
 */
export function sshPath() {
    if (process.platform === 'win32') {
        const bundled = 'C:/Windows/System32/OpenSSH/ssh.exe';
        if (isFile(bundled))
            return bundled;
    }
    return 'ssh';
}
/**
 * Build the client arguments for one remote command.
 *
 * The command runs under a login shell: an ssh session starts a non-interactive
 * shell that never reads `/etc/profile`, so a toolchain installed outside the
 * default `PATH` (Go in `/usr/local/go/bin`, for instance) is missing from it
 * while the logged-in user has it. `bash -lc` puts the command in the same
 * environment a person gets after logging in.
 * @param {RemoteTarget} target - where to connect.
 * @param {string} command - shell command to run in the remote workspace.
 * @returns {string[]} argv for `ssh`, without the program itself.
 */
export function buildSshArgs(target, command) {
    const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15'];
    if (target.keyPath !== null && target.keyPath !== '') {
        args.push('-i', target.keyPath);
    }
    args.push('-p', String(target.port), `${target.user}@${target.host}`);
    args.push(`cd ${shellQuote(target.remotePath)} && bash -lc ${shellQuote(command)}`);
    return args;
}
/**
 * Run one shell command in the remote workspace.
 * @param {RemoteTarget} target - where to connect.
 * @param {string} command - command line written by the stage document.
 * @param {number} [timeoutMs] - wall-clock limit.
 * @returns {Promise<RemoteOutcome>} the outcome.
 */
export function runRemoteCommand(target, command, timeoutMs = REMOTE_TIMEOUT_MS) {
    return new Promise(resolve => {
        let settled = false;
        let output = '';
        let timer = null;
        const finish = (outcome) => {
            if (settled)
                return;
            settled = true;
            if (timer !== null)
                clearTimeout(timer);
            resolve(outcome);
        };
        let child;
        try {
            child = spawn(sshPath(), buildSshArgs(target, command), {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch (error) {
            finish({ code: null, output: error instanceof Error ? error.message : String(error), connectionFailed: true });
            return;
        }
        const collect = (chunk) => {
            output += chunk.toString('utf8');
            if (output.length > 32 * 1024)
                output = output.slice(output.length - 32 * 1024);
        };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        child.on('error', error => {
            finish({ code: null, output: error.message, connectionFailed: true });
        });
        timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch {
                /* already gone */
            }
            finish({ code: null, output: output.trim(), connectionFailed: false });
        }, timeoutMs);
        child.on('close', code => {
            finish({ code, output: output.trim(), connectionFailed: code === SSH_CONNECTION_FAILED });
        });
    });
}
/**
 * Write one file into the remote workspace.
 * @param {RemoteTarget} target - where to connect.
 * @param {string} relativePath - workspace-relative destination.
 * @param {string} content - UTF-8 text to store.
 * @returns {Promise<boolean>} true when the file was written.
 */
export async function writeRemoteFile(target, relativePath, content) {
    const quoted = shellQuote(relativePath);
    const directory = shellQuote(relativePath.split('/').slice(0, -1).join('/'));
    const command = `mkdir -p ${directory} && cat > ${quoted}`;
    return new Promise(resolve => {
        let settled = false;
        let child;
        const finish = (ok) => {
            if (settled)
                return;
            settled = true;
            resolve(ok);
        };
        try {
            child = spawn(sshPath(), buildSshArgs(target, command), {
                windowsHide: true,
                stdio: ['pipe', 'ignore', 'ignore'],
            });
        }
        catch {
            finish(false);
            return;
        }
        child.on('error', () => finish(false));
        child.on('close', code => finish(code === 0));
        child.stdin?.end(content, 'utf8');
    });
}
/** @returns {boolean} true when the workspace directory is a remote mirror. */
export function isRemoteWorkspace(root) {
    return existsSync(join(root, '.dsh-workspace.json'));
}
