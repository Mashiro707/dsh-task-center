/**
 * Verification commands: the only thing that decides whether a stage passed.
 *
 * A stage counts as done when every command its document declares exits 0. The
 * runner executes them itself instead of trusting the agent's report, so a
 * stage cannot be marked complete by assertion.
 */
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolveRemote, runRemoteCommand as runOverSsh } from './remote.js'
import type { RemoteTarget } from './remote.js'

/** Default wall-clock limit for one command. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 120_000

/** How much of a command's combined output is kept, in bytes. */
const MAX_OUTPUT_BYTES = 16 * 1024

/** Result of one verification command. */
export interface VerifyOutcome {
  /** The command line as written in the document. */
  command: string
  /** True only when the command exited 0 within the limit. */
  ok: boolean
  /** Exit code, or null when the process could not run or was killed. */
  code: number | null
  /** True when the limit killed the command. */
  timedOut: boolean
  /** Combined stdout and stderr, tail-truncated. */
  output: string
  /** Why the command could not be started at all, if that happened. */
  error: string | null
  /** Where it ran: this host, or the machine the workspace lives on. */
  where?: 'local' | 'remote'
}

/**
 * The shell a command runs in.
 *
 * Stage documents are written in POSIX shell (`test -f`, `grep -q`, `&&`), and
 * planning agents write them that way on every host. On Windows the default
 * `shell: true` is cmd.exe, where those commands do not exist, so every check
 * fails for a reason that has nothing to do with the stage. Git Bash is the
 * shell the rest of this toolchain already expects; use it when it is there and
 * fall back to the platform default only when it is not.
 */
interface ShellChoice {
  command: string | null
  args: (command: string) => string[]
}

let cachedShell: ShellChoice | undefined

function resolveShell(): ShellChoice {
  if (cachedShell !== undefined) return cachedShell
  if (process.platform === 'win32') {
    const candidates = [
      'C:/Program Files/Git/bin/bash.exe',
      'C:/Program Files/Git/usr/bin/bash.exe',
      'C:/Program Files (x86)/Git/bin/bash.exe',
    ]
    for (const candidate of candidates) {
      try {
        if (statSync(candidate).isFile()) {
          cachedShell = { command: candidate, args: (line: string) => ['-c', line] }
          return cachedShell
        }
      } catch {
        /* keep looking */
      }
    }
    cachedShell = { command: null, args: () => [] }
    return cachedShell
  }
  cachedShell = { command: '/bin/sh', args: (line: string) => ['-c', line] }
  return cachedShell
}

/** @returns {string} the shell a verification command runs in, for messages. */
export function verifyShellName(): string {
  const shell = resolveShell()
  return shell.command === null ? 'the platform shell' : 'bash'
}

/**
 * @param {string} command - shell command line from the document.
 * @param {string} cwd - directory to run it in.
 * @param {number} timeoutMs - wall-clock limit.
 * @returns {Promise<VerifyOutcome>} the outcome.
 */
export function runCommand(command: string, cwd: string, timeoutMs: number): Promise<VerifyOutcome> {
  return new Promise<VerifyOutcome>(resolve => {
    let settled = false
    let output = ''
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (outcome: VerifyOutcome): void => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve(outcome)
    }
    let child
    const shell = resolveShell()
    try {
      child =
        shell.command === null
          ? spawn(command, {
              cwd,
              shell: true,
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            })
          : spawn(shell.command, shell.args(command), {
              cwd,
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            })
    } catch (error) {
      finish({
        command,
        ok: false,
        code: null,
        timedOut: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (output.length > MAX_OUTPUT_BYTES) output = output.slice(output.length - MAX_OUTPUT_BYTES)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', error => {
      finish({
        command,
        ok: false,
        code: null,
        timedOut: false,
        output: output.trim(),
        error: error.message,
      })
    })
    child.on('close', code => {
      finish({
        command,
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        output: output.trim(),
        error: null,
      })
    })
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        try {
          child.kill()
        } catch {
          /* the close handler still resolves the promise */
        }
      }, timeoutMs)
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
    }
  })
}

/**
 * Run every command in order, stopping at the first failure.
 * @param {string[]} commands - command lines from the document.
 * @param {string} cwd - directory to run them in.
 * @param {number} [timeoutMs] - per-command limit.
 * @returns {Promise<VerifyOutcome[]>} outcomes, at most one failure at the end.
 */
export async function runVerifyCommands(
  commands: string[],
  cwd: string,
  timeoutMs: number = DEFAULT_VERIFY_TIMEOUT_MS,
  target: RemoteTarget | null | undefined = undefined,
): Promise<VerifyOutcome[]> {
  // The caller may already know where the directory lives: a worktree sits on
  // the same host as the workspace but is not itself a mirror root.
  const remote = target === undefined ? resolveRemote(cwd) : target
  const outcomes: VerifyOutcome[] = []
  for (const command of commands) {
    if (remote !== null) {
      const result = await runOverSsh(remote, command, timeoutMs)
      const outcome: VerifyOutcome = {
        command,
        ok: result.code === 0,
        code: result.code,
        timedOut: result.code === null && !result.connectionFailed,
        output: result.output,
        error: result.connectionFailed ? `连不上 ${remote.user}@${remote.host}：${result.output}` : null,
        where: 'remote',
      }
      outcomes.push(outcome)
      if (!outcome.ok) break
      continue
    }
    const outcome = await runCommand(command, cwd, timeoutMs)
    outcomes.push(outcome)
    if (!outcome.ok) break
  }
  return outcomes
}

/**
 * @param {string} cwd - workspace directory.
 * @returns {string} '' for a local workspace, otherwise `user@host`.
 */
export function verifyTargetName(cwd: string): string {
  const remote = resolveRemote(cwd)
  return remote === null ? '' : `${remote.user}@${remote.host}`
}
