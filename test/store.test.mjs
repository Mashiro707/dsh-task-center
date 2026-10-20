import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createTaskStore, isTrustedRequest } from '../index.js'

/** One throwaway store rooted at a fresh temp directory. */
async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'task-center-'))
  const dataFile = join(dir, 'tasks.json')
  return {
    dir,
    dataFile,
    store: createTaskStore({ dataFile }),
    dispose: () => rm(dir, { recursive: true, force: true }),
  }
}

test('create persists to disk and list reads it back', async () => {
  const { dataFile, store, dispose } = await makeStore()
  try {
    const created = await store.create({ title: '写插件' })
    assert.equal(created.title, '写插件')
    assert.equal(created.status, 'todo')
    assert.equal(created.priority, 'normal')
    assert.equal(created.parentId, null)
    assert.equal(created.deletedAt, null)

    const listed = await store.list()
    assert.equal(listed.tasks.length, 1)
    assert.equal(listed.tasks[0].id, created.id)

    // A second store over the same file proves the bytes, not the cache.
    const reopened = await createTaskStore({ dataFile }).list()
    assert.equal(reopened.tasks.length, 1)
    assert.equal(reopened.tasks[0].title, '写插件')
    assert.ok((await readFile(dataFile, 'utf8')).includes('写插件'))
  } finally {
    await dispose()
  }
})

test('create rejects an empty title and an unknown status', async () => {
  const { store, dispose } = await makeStore()
  try {
    await assert.rejects(() => store.create({ title: '   ' }), error => error.code === 'invalid-title')
    await assert.rejects(() => store.create({ title: 'ok', status: 'nope' }), error => error.code === 'invalid-status')
    await assert.rejects(() => store.create({ title: 'ok', priority: 'nope' }), error => error.code === 'invalid-priority')
    await assert.rejects(() => store.create({ title: 'ok', due: '2026/01/01' }), error => error.code === 'invalid-due')
  } finally {
    await dispose()
  }
})

test('update moves a task to done and stamps completedAt', async () => {
  const { store, dispose } = await makeStore()
  try {
    const created = await store.create({ title: 'a', tags: ['work', 'work', ' home '] })
    assert.deepEqual(created.tags, ['work', 'home'])

    const done = await store.update({ id: created.id, status: 'done', due: '2026-10-20', notes: '记一下' })
    assert.equal(done.status, 'done')
    assert.equal(done.due, '2026-10-20')
    assert.equal(done.notes, '记一下')
    assert.equal(typeof done.completedAt, 'number')

    const reopened = await store.update({ id: created.id, status: 'doing' })
    assert.equal(reopened.completedAt, null)
  } finally {
    await dispose()
  }
})

test('a task keeps its workspace and permission across a reload', async () => {
  const { dataFile, store, dispose } = await makeStore()
  try {
    const created = await store.create({
      title: '带工作区',
      workspaceId: 'ws-1',
      workspacePath: 'C:/work/app',
      permission: 'auto',
    })
    assert.equal(created.workspaceId, 'ws-1')
    assert.equal(created.workspacePath, 'C:/work/app')
    assert.equal(created.permission, 'auto')

    const reopened = await createTaskStore({ dataFile }).list()
    assert.equal(reopened.tasks[0].workspaceId, 'ws-1')
    assert.equal(reopened.tasks[0].workspacePath, 'C:/work/app')
    assert.equal(reopened.tasks[0].permission, 'auto')

    const cleared = await store.update({ id: created.id, workspaceId: null, workspacePath: null, permission: null })
    assert.equal(cleared.workspaceId, null)
    assert.equal(cleared.workspacePath, null)
    assert.equal(cleared.permission, null)

    const plain = await store.create({ title: '无工作区' })
    assert.equal(plain.workspaceId, null)
    assert.equal(plain.workspacePath, null)
    assert.equal(plain.permission, null)
  } finally {
    await dispose()
  }
})

test('update and remove reject an unknown id', async () => {
  const { store, dispose } = await makeStore()
  try {
    await assert.rejects(() => store.update({ id: 'nope', title: 'x' }), error => error.code === 'not-found')
    await assert.rejects(() => store.remove({ id: 'nope' }), error => error.code === 'not-found')
  } finally {
    await dispose()
  }
})

test('subtasks are one level deep and delete/restore travel with the parent', async () => {
  const { store, dispose } = await makeStore()
  try {
    const parent = await store.create({ title: 'parent' })
    const child = await store.create({ title: 'child', parentId: parent.id })
    assert.equal(child.parentId, parent.id)

    await assert.rejects(
      () => store.create({ title: 'grandchild', parentId: child.id }),
      error => error.code === 'subtask-depth',
    )
    await assert.rejects(
      () => store.update({ id: parent.id, parentId: parent.id }),
      error => error.code === 'invalid-parent',
    )

    await store.remove({ id: parent.id })
    const trashed = await store.list()
    assert.equal(trashed.tasks.length, 0, 'soft delete hides the whole tree')
    assert.equal(trashed.trash.length, 1)
    assert.equal(trashed.trash[0].id, parent.id)
    assert.equal(trashed.trash[0].count, 2, 'the trash row counts the parent plus its child')

    await store.restore({ id: parent.id })
    const back = await store.list()
    assert.equal(back.tasks.length, 2)
    assert.equal(back.trash.length, 0)

    await store.remove({ id: parent.id })
    await store.purge({ id: parent.id })
    const purged = await store.list()
    assert.equal(purged.trash.length, 0)
    const raw = JSON.parse(await readFile((await store.list()).dataFile, 'utf8'))
    assert.equal(raw.tasks.length, 0, 'purge deletes the parent and its child for good')
  } finally {
    await dispose()
  }
})

test('emptyTrash clears every trashed tree', async () => {
  const { store, dispose } = await makeStore()
  try {
    const a = await store.create({ title: 'a' })
    const b = await store.create({ title: 'b' })
    await store.remove({ id: a.id })
    await store.remove({ id: b.id })
    await store.emptyTrash()
    const state = await store.list()
    assert.equal(state.trash.length, 0)
    assert.equal(state.tasks.length, 0)
  } finally {
    await dispose()
  }
})

test('a corrupt data file is backed up and the store starts empty', async () => {
  const { dir, dataFile, dispose } = await makeStore()
  try {
    await writeFile(dataFile, '{ this is not json', 'utf8')
    const store = createTaskStore({ dataFile })
    const state = await store.list()
    assert.equal(state.tasks.length, 0)
    assert.match(String(state.warning ?? ''), /corrupt/)

    await store.create({ title: 'fresh' })
    assert.equal((await store.list()).tasks.length, 1)
    assert.ok(dir.length > 0)
  } finally {
    await dispose()
  }
})

test('the request fence accepts loopback and rejects cross-site', () => {
  assert.equal(isTrustedRequest({ host: '127.0.0.1:63788', 'sec-fetch-site': 'same-origin' }), true)
  assert.equal(isTrustedRequest({ host: 'localhost:63788' }), true)
  assert.equal(isTrustedRequest({ host: '127.0.0.1:63788', 'sec-fetch-site': 'cross-site' }), false)
  assert.equal(isTrustedRequest({ host: 'evil.example.com' }), false)
  assert.equal(isTrustedRequest({ host: '127.0.0.1:63788', origin: 'https://evil.example.com' }), false)
  assert.equal(isTrustedRequest({ host: '127.0.0.1:63788', origin: 'http://127.0.0.1:63788' }), true)
})
