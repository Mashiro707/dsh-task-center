/**
 * Per-task Git isolation.
 *
 * A task must not edit the branch the user is working on. Every run gets its own
 * `git worktree` under the repository it touches, on a branch named after the
 * task, so a stage can be reviewed, re-run or thrown away without disturbing
 * anyone else's checkout.
 *
 * Pure helpers only: the caller supplies the shell, so the same code serves a
 * local directory and a workspace whose repository lives on another machine.
 */

export const WORKTREE_DIR = '.worktrees'

/** Branch a task's work lives on. */
export function worktreeBranch(taskId: string): string {
  return `task-center/${taskId}`
}

/** Directory of a task's worktree, inside the repository it belongs to. */
export function worktreePath(repoRoot: string, taskId: string): string {
  const base = repoRoot.replace(/[\\/]+$/, '')
  const windows = base.includes('\\') && !base.includes('/')
  const separator = windows ? '\\' : '/'
  return `${base}${separator}${WORKTREE_DIR}${separator}${taskId}`
}

/**
 * Choose the repository a stage belongs to when the workspace holds several.
 * A candidate scores one point per scope entry that exists under it; the
 * highest score wins, and no score at all means we cannot decide.
 * @param {readonly string[]} candidates - repository roots, relative or absolute.
 * @param {readonly string[]} scope - paths the stage is allowed to touch.
 * @param {(repo: string, entry: string) => boolean} exists - does `repo/entry` exist.
 * @returns {string | null} the winner, or null when nothing matched.
 */
export function pickRepo(
  candidates: readonly string[],
  scope: readonly string[],
  exists: (repo: string, entry: string) => boolean,
): string | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  let best: string | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    let score = 0
    for (const entry of scope) {
      if (exists(candidate, entry)) score += 1
    }
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}
