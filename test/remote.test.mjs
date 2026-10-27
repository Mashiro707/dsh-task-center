/**
 * Remote workspaces: reading the mirror, finding the host, and the client
 * arguments the verifier would use.
 *
 * Nothing here connects to a machine; the point is that a remote workspace is
 * recognised instead of being verified against its local mirror.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildSshArgs,
  mapToRemotePath,
  readMirrorMarker,
  readVaultHost,
  resolveRemote,
  shellQuote,
  sshPath,
} from '../remote.js'
import { verifyTargetName } from '../verify.js'

const HOST_ID = 'host-1'

/**
 * Make a harness home with one vault host plus one remote mirror.
 * @returns {{ home: string, mirror: string, cleanup: () => void }} fixture paths.
 */
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'tc-remote-'))
  const mirror = join(home, 'workspaces', 'remote', '10.0.0.9-root-2222', 'work')
  mkdirSync(join(mirror, 'docs'), { recursive: true })
  mkdirSync(join(home, 'workspaces'), { recursive: true })
  writeFileSync(
    join(home, 'workspaces', 'vault.json'),
    JSON.stringify({
      version: 1,
      hosts: {
        [HOST_ID]: {
          label: 'dev',
          hostname: '10.0.0.9',
          port: 2222,
          username: 'root',
          auth: { kind: 'keyPath', keyPath: 'C:/Users/x/.ssh/id_rsa' },
        },
      },
    }),
  )
  writeFileSync(
    join(mirror, '.dsh-workspace.json'),
    JSON.stringify({ kind: 'dsh-workspace/remote', version: 1, hostId: HOST_ID, remotePath: '/root/go/work' }),
  )
  return {
    home,
    mirror,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  }
}

test('a mirror marker is read from the workspace directory', () => {
  const { home, mirror, cleanup } = fixture()
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.deepEqual(readMirrorMarker(mirror), { hostId: HOST_ID, remotePath: '/root/go/work' })
    assert.equal(readMirrorMarker(home), null, 'a directory without a marker is not a mirror')
  } finally {
    process.env.DSH_HOME = previous
    cleanup()
  }
})

test('the host is found in the workspace vault', () => {
  const { home, cleanup } = fixture()
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.deepEqual(readVaultHost(HOST_ID), {
      host: '10.0.0.9',
      port: 2222,
      user: 'root',
      keyPath: 'C:/Users/x/.ssh/id_rsa',
    })
    assert.equal(readVaultHost('missing'), null)
  } finally {
    process.env.DSH_HOME = previous
    cleanup()
  }
})

test('a local workspace resolves to no remote target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tc-local-'))
  try {
    assert.equal(resolveRemote(dir), null)
    assert.equal(verifyTargetName(dir), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a mirror resolves to the host and its remote path', () => {
  const { home, mirror, cleanup } = fixture()
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const target = resolveRemote(mirror)
    assert.ok(target !== null)
    assert.equal(target.host, '10.0.0.9')
    assert.equal(target.port, 2222)
    assert.equal(target.user, 'root')
    assert.equal(target.remotePath, '/root/go/work')
    assert.equal(verifyTargetName(mirror), 'root@10.0.0.9', 'verification names the remote host')
  } finally {
    process.env.DSH_HOME = previous
    cleanup()
  }
})

test('a mirror whose host is missing from the vault stays local', () => {
  const { home, mirror, cleanup } = fixture()
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    writeFileSync(join(home, 'workspaces', 'vault.json'), JSON.stringify({ version: 1, hosts: {} }))
    assert.equal(resolveRemote(mirror), null)
  } finally {
    process.env.DSH_HOME = previous
    cleanup()
  }
})

test('the client arguments carry the key, the port and the directory', () => {
  const target = {
    host: '10.0.0.9',
    port: 2222,
    user: 'root',
    keyPath: 'C:/Users/x/.ssh/id_rsa',
    remotePath: '/root/go/work',
    localPath: 'C:/mirror',
  }
  const args = buildSshArgs(target, 'go build ./...')
  assert.ok(args.includes('-i'))
  assert.ok(args.includes('C:/Users/x/.ssh/id_rsa'))
  assert.ok(args.includes('-p'))
  assert.ok(args.includes('2222'))
  assert.ok(args.includes('root@10.0.0.9'))
  assert.ok(
    args.includes("cd '/root/go/work' && bash -lc 'go build ./...'"),
    'the command runs in the remote workspace, in a login shell',
  )
  assert.ok(args.includes('BatchMode=yes'), 'a missing key fails instead of prompting')
})

test('a workspace without a key omits the identity argument', () => {
  const args = buildSshArgs(
    { host: 'h', port: 22, user: 'u', keyPath: null, remotePath: '/w', localPath: 'C:/m' },
    'ls',
  )
  assert.equal(args.includes('-i'), false)
})

test('single quotes survive shell quoting', () => {
  assert.equal(shellQuote("/root/it's here"), "'/root/it'\\''s here'")
})

test('the ssh client is always named', () => {
  assert.match(sshPath(), /ssh(\.exe)?$/)
})

test('a mirrored path maps onto the path that host really owns', () => {
  const local = String.raw`C:\Users\mashi\.dsh\workspaces\remote\10.0.0.9-root-2222\work`
  const remote = '/root/go/work'
  assert.equal(mapToRemotePath(local, remote, local), '/root/go/work', 'the mirror root is the remote root')
  assert.equal(
    mapToRemotePath(local, remote, local + String.raw`\.worktrees\t_abc`),
    '/root/go/work/.worktrees/t_abc',
    'a worktree under the mirror maps the same way',
  )
  assert.equal(mapToRemotePath(local, remote, ''), '/root/go/work', 'an empty path means the root')
})

test('a path already absolute on the host is passed through', () => {
  const local = String.raw`C:\mirror\work`
  assert.equal(mapToRemotePath(local, '/root/go/work', '/root/go/work/x'), '/root/go/work/x')
  assert.equal(mapToRemotePath(local, '/root/go/work/', '/srv/other'), '/srv/other', 'trailing slashes do not leak')
})
