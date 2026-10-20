import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createTaskStore } from '../index.js'
import { apply } from '../index.js'
import { buildPrompt, createRunner, createUserMessage } from '../runner.js'

/** Poll until `check` returns something truthy, or fail. */
async function waitFor(check, timeout = 2000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('timed out waiting for the run to settle')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A fake host: a session controller, presets, an event bus and a logger. */
function makeHost(options = {}) {
  const listeners = new Map()
  const created = []
  const installed = []
  const agents = new Map()
  const available = options.presets === undefined ? ['auto'] : options.presets

  const controller = {
    async create(request) {
      created.push(request)
      const id = 'session-' + created.length
      const agent = {
        id,
        session: { id },
        status: 'idle',
        inbox: [],
        followup(message) {
          this.inbox.push(message)
          this.status = 'running'
        },
      }
      agents.set(id, agent)
      return { sessionId: id }
    },
    async resolveAgent(sessionId) {
      const agent = agents.get(sessionId)
      return agent === undefined ? { error: new Error('No such session: ' + sessionId) } : { agent }
    },
    cancel({ sessionId }) {
      const agent = agents.get(sessionId)
      if (agent !== undefined) agent.status = 'cancelled'
    },
  }

  const presets = {
    catalog: () => ({ options: available.map((value) => ({ value, name: value })) }),
    set: (session, name) => installed.push({ session, name }),
    resolve: () => ({}),
  }

  const ctx = {
    logger: { warn() {}, info() {} },
    webServer: { register: () => () => {} },
    tools: { register: () => () => {} },
    get(name) {
      if (name === 'sessionController') return controller
      if (name === 'permissionPresets') return presets
      return undefined
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(listener)
      return () => {}
    },
    effect: (run) => run(),
  }

  return {
    ctx,
    created,
    installed,
    agents,
    emit(event, payload) {
      for (const listener of listeners.get(event) || []) listener(payload)
    },
  }
}

/** A real store over a temp file, plus its directory. */
async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'task-center-run-'))
  const dataFile = join(dir, 'tasks.json')
  return {
    dir,
    dataFile,
    store: createTaskStore({ dataFile }),
    dispose: () => rm(dir, { recursive: true, force: true }),
  }
}

test('a run uses the task directory and admits one message', async () => {
  const { dataFile, store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '修登录接口', cwd: 'C:/work/app' })

    const result = await runner.start(task.id)
    assert.equal(host.created.length, 1)
    assert.equal(host.created[0].cwd, 'C:/work/app')
    assert.equal(result.status, 'doing')
    assert.equal(result.run.status, 'running')
    assert.equal(result.run.sessionId, 'session-1')
    assert.equal(host.installed.length, 1)
    assert.equal(host.installed[0].name, 'auto')

    const agent = host.agents.get('session-1')
    assert.equal(agent.inbox.length, 1)
    const message = agent.inbox[0]
    assert.equal(message.role, 'user')
    assert.equal(message.source.kind, 'user')
    assert.equal(message.content.length, 1)
    assert.equal(message.content[0].type, 'text')
    assert.ok(message.content[0].text.includes('修登录接口'))
    assert.ok(message.content[0].text.includes(task.id))
    assert.ok(message.content[0].text.includes('C:/work/app'))
  } finally {
    await dispose()
  }
})

test('a task without a directory is refused before any session exists', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '没有目录' })
    await assert.rejects(runner.start(task.id), (error) => error.code === 'cwd-missing')
    assert.equal(host.created.length, 0)
  } finally {
    await dispose()
  }
})

test('one task cannot be running twice', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '单次', cwd: 'C:/work/app' })
    await runner.start(task.id)
    await assert.rejects(runner.start(task.id), (error) => error.code === 'running')
    assert.equal(host.created.length, 1)
  } finally {
    await dispose()
  }
})

test('the concurrency cap turns the next start away', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    await runner.saveSettings({ concurrency: 1 })
    const first = await store.create({ title: '一', cwd: 'C:/work/a' })
    const second = await store.create({ title: '二', cwd: 'C:/work/b' })
    await runner.start(first.id)
    await assert.rejects(runner.start(second.id), (error) => error.code === 'busy')
  } finally {
    await dispose()
  }
})

test('going idle closes the run, and the outcome lands in the store', async () => {
  const { dataFile, store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '跑完', cwd: 'C:/work/app' })
    await runner.start(task.id)
    const agent = host.agents.get('session-1')

    host.emit('agent/status', { agent, status: 'idle' })
    const settled = await waitFor(async () => {
      const row = (await store.list()).tasks.find((entry) => entry.id === task.id)
      return row.run.status === 'done' ? row : null
    })
    assert.ok(settled.run.endedAt > 0)
    assert.equal(settled.run.message, null)

    // And it survived a reload, which proves the row was written.
    const reopened = await createTaskStore({ dataFile }).list()
    assert.equal(reopened.tasks[0].run.status, 'done')
  } finally {
    await dispose()
  }
})

test('an agent error marks the run failed and keeps the message', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '炸了', cwd: 'C:/work/app' })
    await runner.start(task.id)
    const agent = host.agents.get('session-1')

    host.emit('agent/error', { agent, error: new Error('模型超时') })
    const settled = await waitFor(async () => {
      const row = (await store.list()).tasks.find((entry) => entry.id === task.id)
      return row.run.status === 'failed' ? row : null
    })
    assert.equal(settled.run.message, '模型超时')
  } finally {
    await dispose()
  }
})

test('cancelling a run stops its session and closes the row', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '停止', cwd: 'C:/work/app' })
    await runner.start(task.id)

    const outcome = await runner.cancel(task.id)
    assert.deepEqual(outcome, { canceled: true })
    assert.equal(host.agents.get('session-1').status, 'cancelled')
    const row = (await store.list()).tasks.find((entry) => entry.id === task.id)
    assert.equal(row.run.status, 'failed')
    assert.equal(row.run.message, '已取消')
    // Cancelling twice is a no-op, not an error.
    assert.deepEqual(await runner.cancel(task.id), { canceled: false })
  } finally {
    await dispose()
  }
})

test('auto-run stays off until it is switched on', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const idle = await store.create({ title: '只是待办', cwd: 'C:/work/app' })
    runner.onTaskChanged(idle)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(host.created.length, 0)

    await runner.saveSettings({ autoRun: true })
    const doing = await store.create({ title: '自动开跑', status: 'doing', cwd: 'C:/work/app' })
    runner.onTaskChanged(doing)
    await waitFor(() => host.created.length === 1)
    const row = (await store.list()).tasks.find((entry) => entry.id === doing.id)
    assert.equal(row.run.status, 'running')
  } finally {
    await dispose()
  }
})

test('settings persist, clamp and reload', async () => {
  const { dir, store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    assert.deepEqual(await runner.settings(), { autoRun: false, concurrency: 2, preset: 'auto' })

    const saved = await runner.saveSettings({ autoRun: true, concurrency: 3, preset: 'auto' })
    assert.deepEqual(saved, { autoRun: true, concurrency: 3, preset: 'auto' })
    const raw = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    assert.equal(raw.autoRun, true)
    assert.equal(raw.concurrency, 3)

    const clamped = await runner.saveSettings({ concurrency: 99 })
    assert.equal(clamped.concurrency, 4)
    assert.equal(clamped.autoRun, true, 'a partial patch keeps the rest')

    const fresh = createRunner(host.ctx, store)
    assert.deepEqual(await fresh.settings(), { autoRun: true, concurrency: 4, preset: 'auto' })
  } finally {
    await dispose()
  }
})

test('an uncomposed session controller is reported, not crashed', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const bare = Object.assign({}, host.ctx, { get: () => undefined })
    const runner = createRunner(bare, store)
    const task = await store.create({ title: '无宿主', cwd: 'C:/work/app' })
    await assert.rejects(runner.start(task.id), (error) => error.code === 'unavailable')
    assert.deepEqual(await runner.settings(), { autoRun: false, concurrency: 2, preset: 'auto' })
  } finally {
    await dispose()
  }
})

test('reconcile marks runs left over from a previous load as interrupted', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '孤儿', cwd: 'C:/work/app' })
    await store.update({
      id: task.id,
      run: { sessionId: 'session-gone', status: 'running', startedAt: 1, endedAt: null, message: null },
    })

    assert.deepEqual(await runner.reconcile(), { repaired: 1 })
    const row = (await store.list()).tasks.find((entry) => entry.id === task.id)
    assert.equal(row.run.status, 'failed')
    assert.ok(row.run.message.includes('运行中断'))
    // Idempotent: nothing left to repair.
    assert.deepEqual(await runner.reconcile(), { repaired: 0 })
  } finally {
    await dispose()
  }
})

test('the route dispatches run, settings and the delete alias', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-center-route-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const host = makeHost()
    let handler = null
    const ctx = Object.assign({}, host.ctx, {
      webServer: {
        register(route) {
          handler = route.handler
          return () => {
            handler = null
          }
        },
      },
    })
    apply(ctx)

    /** One fake request/response round trip through the real dispatcher. */
    const post = async (method, body) => {
      const request = {
        method: 'POST',
        url: '/task-center/api' + method,
        headers: { host: 'localhost:51924' },
        async *[Symbol.asyncIterator]() {
          if (body !== undefined) yield Buffer.from(JSON.stringify(body))
        },
      }
      const response = {
        statusCode: 200,
        body: '',
        setHeader() {},
        end(chunk) {
          this.body = String(chunk)
        },
      }
      await handler(request, response)
      const envelope = JSON.parse(response.body)
      return { status: response.statusCode, ok: envelope.ok, value: envelope.value, error: envelope.error }
    }

    const created = await post('/create', { title: '路由测试', cwd: 'C:/work/app' })
    assert.equal(created.status, 200)
    const id = created.value.id

    const settings = await post('/settings', {})
    assert.equal(settings.status, 200)
    assert.equal(settings.value.autoRun, false)
    assert.equal(settings.value.concurrency, 2)
    assert.equal(settings.value.available, true)

    const saved = await post('/saveSettings', { autoRun: true })
    assert.equal(saved.value.autoRun, true)

    const ran = await post('/run', { id })
    assert.equal(ran.status, 200)
    assert.equal(ran.value.run.status, 'running')
    assert.equal(host.created.length, 1)

    const stopped = await post('/cancelRun', { id })
    assert.equal(stopped.value.canceled, true)

    const listed = await post('/list', {})
    assert.equal(listed.value.tasks.some((task) => task.id === id), true)

    // The panel has always said `delete`; the route keeps that spelling too.
    const deleted = await post('/delete', { id })
    assert.equal(deleted.status, 200)
    assert.equal((await post('/list', {})).value.tasks.some((task) => task.id === id), false)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('the prompt is built from the task and the message is frozen', async () => {
  const task = {
    id: 't1',
    title: '加搜索',
    notes: '要防抖',
    status: 'doing',
    priority: 'high',
    due: '2026-11-01',
    tags: ['ui', 'search'],
    cwd: 'C:/work/app',
    run: null,
    parentId: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    deletedAt: null,
    trashRoot: null,
  }
  const prompt = buildPrompt(task, 'C:/work/app')
  assert.ok(prompt.includes('加搜索'))
  assert.ok(prompt.includes('要防抖'))
  assert.ok(prompt.includes('ui / search'))
  assert.ok(prompt.includes('t1'))

  const message = createUserMessage('hello')
  assert.ok(Object.isFrozen(message))
  assert.ok(Object.isFrozen(message.content))
  assert.equal(message.role, 'user')
  assert.notEqual(createUserMessage('hello').id, message.id)
})
