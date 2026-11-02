import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WORKTREE_DIR,
  pickRepo,
  removeWorktreeCommands,
  worktreeBranch,
  worktreeIsDirty,
  worktreePath,
} from '../worktree.js'

test('a task gets a branch of its own', () => {
  assert.equal(worktreeBranch('t_abc12345_9f8e7d6c'), 'task-center/t_abc12345_9f8e7d6c')
})

test('the worktree lives inside the repository it belongs to', () => {
  assert.equal(
    worktreePath('/root/go/work/allynav-data-v2', 't_abc'),
    `/root/go/work/allynav-data-v2/${WORKTREE_DIR}/t_abc`,
  )
  assert.equal(
    worktreePath('C:\\work\\repo\\', 't_abc'),
    `C:\\work\\repo\\${WORKTREE_DIR}\\t_abc`,
  )
})

test('a repository on its own needs no guessing', () => {
  assert.equal(pickRepo(['/w/only'], ['app/a.go'], () => false), '/w/only')
})

test('the stage scope decides between several repositories', () => {
  const scope = ['app/export/service/internal/server/http.go', 'app/export/x_test.go']
  const chosen = pickRepo(
    ['/w/allynav-data-v2', '/w/farminfo-biz'],
    scope,
    (repo, entry) => repo === '/w/allynav-data-v2' && entry.startsWith('app/export/'),
  )
  assert.equal(chosen, '/w/allynav-data-v2')
})

test('no scope and no single repository means no decision', () => {
  assert.equal(pickRepo(['/w/a', '/w/b'], ['x.go'], () => false), null)
  assert.equal(pickRepo([], ['x.go'], () => false), null)
})

test('cleanup removes the worktree first and the branch after', () => {
  const commands = removeWorktreeCommands('C:/repo/.worktrees/t_1', 'task-center/t_1')
  assert.equal(commands[0], 'git worktree remove --force "C:/repo/.worktrees/t_1"')
  assert.equal(commands[1], 'git branch -D "task-center/t_1"')
  assert.equal(commands[2], 'git worktree prune')
})

test('only real output counts as uncommitted work', () => {
  assert.equal(worktreeIsDirty(''), false)
  assert.equal(worktreeIsDirty('  \n'), false)
  assert.equal(worktreeIsDirty(' M a.txt\n'), true)
  assert.equal(worktreeIsDirty('?? scratch.txt'), true)
})
