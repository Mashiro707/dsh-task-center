/**
 * Verification commands: the only thing that decides whether a stage passed.
 *
 * A stage counts as done when every command its document declares exits 0. The
 * runner executes them itself instead of trusting the agent's report, so a
 * stage cannot be marked complete by assertion.
 */
import { spawn } from 'node:child_process';
/** Default wall-clock limit for one command. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;
/** How much of a command's combined output is kept, in bytes. */
const MAX_OUTPUT_BYTES = 16 * 1024;
/**
 * @param {string} command - shell command line from the document.
 * @param {string} cwd - directory to run it in.
 * @param {number} timeoutMs - wall-clock limit.
 * @returns {Promise<VerifyOutcome>} the outcome.
 */
export function runCommand(command, cwd, timeoutMs) {
    return new Promise(resolve => {
        let settled = false;
        let output = '';
        let timedOut = false;
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
            child = spawn(command, {
                cwd,
                shell: true,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        }
        catch (error) {
            finish({
                command,
                ok: false,
                code: null,
                timedOut: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }
        const collect = (chunk) => {
            output += chunk.toString('utf8');
            if (output.length > MAX_OUTPUT_BYTES)
                output = output.slice(output.length - MAX_OUTPUT_BYTES);
        };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        child.on('error', error => {
            finish({
                command,
                ok: false,
                code: null,
                timedOut: false,
                output: output.trim(),
                error: error.message,
            });
        });
        child.on('close', code => {
            finish({
                command,
                ok: code === 0 && !timedOut,
                code,
                timedOut,
                output: output.trim(),
                error: null,
            });
        });
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                timedOut = true;
                try {
                    child.kill();
                }
                catch {
                    /* the close handler still resolves the promise */
                }
            }, timeoutMs);
            if (typeof timer === 'object' && timer !== null && 'unref' in timer)
                timer.unref();
        }
    });
}
/**
 * Run every command in order, stopping at the first failure.
 * @param {string[]} commands - command lines from the document.
 * @param {string} cwd - directory to run them in.
 * @param {number} [timeoutMs] - per-command limit.
 * @returns {Promise<VerifyOutcome[]>} outcomes, at most one failure at the end.
 */
export async function runVerifyCommands(commands, cwd, timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS) {
    const outcomes = [];
    for (const command of commands) {
        const outcome = await runCommand(command, cwd, timeoutMs);
        outcomes.push(outcome);
        if (!outcome.ok)
            break;
    }
    return outcomes;
}
