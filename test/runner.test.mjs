import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createTaskStore } from '../index.js'
import { apply } from '../index.js'
import { buildPrompt, createRunner, createUserMessage, service } from '../runner.js'

/** Poll until `check` returns something truthy, or fail. */
async function waitFor(check, timeout = 20000) {
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
      // Optional gate: lets a test observe the window before the session exists.
      if (options.gate !== undefined) await options.gate
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
      // Optional: let a test deliver events before `create()` resolves, which is
      // the window where an idle can beat the runner's own bookkeeping.
      if (options.afterCreate !== undefined) options.afterCreate(agent)
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

  const specs =
    options.specs === undefined
      ? { auto: { sandbox: 'danger-full-access' }, 'workspace-write': { sandbox: 'workspace-write' }, 'read-only': { sandbox: 'read-only' } }
      : options.specs
  const presets = {
    catalog: () => ({ options: available.map((value) => ({ value, name: value })) }),
    set: (session, name) => installed.push({ session, name }),
    resolve: (name) => specs[name] ?? {},
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
    controller,
    presets,
    created,
    installed,
    agents,
    emit(event, ...args) {
      for (const listener of listeners.get(event) || []) listener(...args)
    },
    async emitAsync(event, ...args) {
      const results = []
      for (const listener of listeners.get(event) || []) results.push(await listener(...args))
      return results
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

test('a task with neither a workspace nor a directory is refused before any session exists', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '没有目录' })
    await assert.rejects(runner.start(task.id), (error) => error.code === 'workspace-missing')
    assert.equal(host.created.length, 0)
  } finally {
    await dispose()
  }
})

test('a workspace task opens its session inside that workspace', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '用工作区', workspaceId: 'ws-1', workspacePath: 'C:/work/app' })

    const result = await runner.start(task.id)
    assert.equal(host.created.length, 1)
    assert.equal(host.created[0].workspaceId, 'ws-1')
    assert.equal(host.created[0].cwd, undefined)
    assert.equal(result.run.status, 'running')
    assert.ok(result.run.sessionId.startsWith('session-'))
  } finally {
    await dispose()
  }
})

test('a task permission preset overrides the global one', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost({ presets: ['auto', 'yolo'] })
    const runner = createRunner(host.ctx, store)
    await runner.saveSettings({ preset: 'auto' })
    const task = await store.create({ title: '自定义权限', cwd: 'C:/work/app', permission: 'yolo' })

    await runner.start(task.id)
    assert.deepEqual(host.installed.map((entry) => entry.name), ['yolo'])
  } finally {
    await dispose()
  }
})

test('a task that must stay in its workspace runs with a capped sandbox', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost({ presets: ['auto', 'workspace-write'] })
    const runner = createRunner(host.ctx, store)
    await runner.saveSettings({ preset: 'auto' })
    const task = await store.create({ title: '别越界', workspaceId: 'ws-1', workspacePath: 'C:/work/app' })

    await runner.start(task.id)
    // `auto` is danger-full-access: the sandbox would let the agent write
    // anywhere, so no approval would ever ask and the workspace would not be a
    // boundary at all.
    assert.deepEqual(host.installed.map((entry) => entry.name), ['workspace-write'])
  } finally {
    await dispose()
  }
})

test('a task that asks to be approved every time keeps the wider sandbox', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost({ presets: ['auto', 'workspace-write'] })
    const runner = createRunner(host.ctx, store)
    await runner.saveSettings({ preset: 'auto' })
    const task = await store.create({
      title: '我要被问',
      workspaceId: 'ws-1',
      workspacePath: 'C:/work/app',
      autoApprove: false,
    })

    await runner.start(task.id)
    assert.deepEqual(host.installed.map((entry) => entry.name), ['auto'])
  } finally {
    await dispose()
  }
})

test('one task cannot be running twice', async () => {  const { store, dispose } = await makeStore()
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

test('the concurrency cap parks the next start in the queue', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    await runner.saveSettings({ concurrency: 1 })
    const first = await store.create({ title: '一', cwd: 'C:/work/a' })
    const second = await store.create({ title: '二', cwd: 'C:/work/b' })

    await runner.start(first.id)
    const parked = await runner.start(second.id)
    assert.equal(parked.run.status, 'queued')
    assert.equal(parked.run.sessionId, null)
    assert.equal(parked.status, 'todo', '排队不算开跑')

    const state = await runner.queue()
    assert.deepEqual(state.queued, [second.id])
    assert.equal(state.running, 1)
    assert.equal(state.concurrency, 1)

    // Nothing was created for the parked task.
    assert.equal(host.created.length, 1)

    // Finishing the first one lets the second start by itself.
    host.emit('agent/status', { agent: host.agents.get('session-1'), status: 'idle' })
    const started = await waitFor(async () => {
      const row = (await store.list()).tasks.find((entry) => entry.id === second.id)
      return row.run !== null && row.run.status === 'running' ? row : null
    })
    assert.equal(started.run.sessionId, 'session-2')
    assert.equal(host.created.length, 2)
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

test('a cancel that lands mid-launch still stops the session', async () => {
  const { store, dispose } = await makeStore()
  try {
    // Hold `create` open so the test can cancel in that exact window.
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const host = makeHost({ gate })
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '抢跑', cwd: 'C:/work/app' })

    const started = runner.start(task.id)
    // Give `start` a tick to reach `create`, then cancel before it resolves.
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(await runner.cancel(task.id), { canceled: true })
    release()
    await started

    assert.equal(host.agents.get('session-1').status, 'cancelled')
    const row = (await store.list()).tasks.find((entry) => entry.id === task.id)
    assert.equal(row.run.status, 'failed')
    assert.equal(row.run.message, '已取消')
    assert.equal(host.agents.get('session-1').inbox.length, 0, 'the prompt must not be delivered')
    assert.deepEqual((await runner.queue()).queued, [])
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
    assert.deepEqual(await runner.settings(), {
      autoRun: false,
      concurrency: 2,
      preset: 'auto',
      timeoutMinutes: 30,
      retries: 0,
    })

    const saved = await runner.saveSettings({ autoRun: true, concurrency: 3, preset: 'auto' })
    assert.equal(saved.autoRun, true)
    assert.equal(saved.concurrency, 3)
    assert.equal(saved.preset, 'auto')
    const raw = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    assert.equal(raw.autoRun, true)
    assert.equal(raw.concurrency, 3)

    const clamped = await runner.saveSettings({ concurrency: 99 })
    assert.equal(clamped.concurrency, 4)
    assert.equal(clamped.autoRun, true, 'a partial patch keeps the rest')

    const fresh = createRunner(host.ctx, store)
    const reloaded = await fresh.settings()
    assert.equal(reloaded.autoRun, true)
    assert.equal(reloaded.concurrency, 4)
    assert.equal(reloaded.preset, 'auto')
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
    assert.deepEqual(await runner.settings(), {
      autoRun: false,
      concurrency: 2,
      preset: 'auto',
      timeoutMinutes: 30,
      retries: 0,
    })
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

    assert.deepEqual(await runner.reconcile(), { repaired: 1, requeued: 0 })
    const row = (await store.list()).tasks.find((entry) => entry.id === task.id)
    assert.equal(row.run.status, 'failed')
    assert.ok(row.run.message.includes('运行中断'))
    // Idempotent: nothing left to repair.
    assert.deepEqual(await runner.reconcile(), { repaired: 0, requeued: 0 })
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

    // And `permanent` erases instead of parking the row in the recycle bin.
    const second = await post('/create', { title: '彻底删除' })
    await post('/delete', { id: second.value.id, permanent: true })
    const board = (await post('/list', {})).value
    assert.equal(board.tasks.some((task) => task.id === second.value.id), false)
    assert.equal(board.trash.some((task) => task.id === second.value.id), false)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('the workspace and permission routes feed the drawer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-center-ws-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const host = makeHost({ presets: ['auto', 'yolo'] })
    const workspaces = [{ id: 'ws-1', path: 'C:/work/app', title: 'app', sessionIds: [], attachSession() {} }]
    const registry = {
      list: () => workspaces.slice(),
      get: (id) => workspaces.find((workspace) => workspace.id === id),
      create(path, title) {
        const workspace = { id: 'ws-' + (workspaces.length + 1), path, title: title === undefined ? path : title, sessionIds: [], attachSession() {} }
        workspaces.push(workspace)
        return workspace
      },
    }
    const presets = Object.assign({}, host.presets, {
      catalog: () => ({ options: [{ value: 'auto', name: 'Auto' }, { value: 'yolo', name: 'Yolo' }], defaultPreset: 'auto' }),
    })

    let handler = null
    const ctx = Object.assign({}, host.ctx, {
      webServer: { register: (route) => ((handler = route.handler), () => (handler = null)) },
      get(name) {
        if (name === 'workspaceRegistry') return registry
        if (name === 'permissionPresets') return presets
        return host.ctx.get(name)
      },
    })
    apply(ctx)

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
      return JSON.parse(response.body)
    }

    const listed = await post('/workspaces', {})
    assert.equal(listed.value.available, true)
    assert.deepEqual(listed.value.workspaces, [{ id: 'ws-1', title: 'app', path: 'C:/work/app' }])

    const createdWs = await post('/createWorkspace', { path: 'C:/work/other' })
    assert.equal(createdWs.value.id, 'ws-2')
    assert.equal(createdWs.value.path, 'C:/work/other')

    const catalog = await post('/permissions', {})
    assert.equal(catalog.value.available, true)
    assert.deepEqual(catalog.value.options.map((option) => option.value), ['auto', 'yolo'])
    assert.equal(catalog.value.defaultPreset, 'auto')

    const task = await post('/create', { title: '工作区任务', workspaceId: 'ws-1', permission: 'yolo' })
    assert.equal(task.value.workspaceId, 'ws-1')
    assert.equal(task.value.permission, 'yolo')

    const ran = await post('/run', { id: task.value.id })
    assert.equal(ran.value.run.status, 'running')
    assert.equal(host.created.length, 1)
    assert.equal(host.created[0].workspaceId, 'ws-1')
    assert.equal(host.created[0].cwd, undefined)
    assert.deepEqual(host.installed.map((entry) => entry.name), ['yolo'])
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('an idle that beats the session mapping still closes the run', async () => {
  const { store, dispose } = await makeStore()
  try {
    // The agent reports idle while `create()` is still resolving, i.e. before the
    // runner has any chance to record which task owns the session.
    const host = makeHost({
      afterCreate: (agent) => host.emit('agent/status', { agent, status: 'idle' }),
    })
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '抢跑', cwd: 'C:/work/early' })

    await runner.start(task.id)
    const row = await waitFor(async () => {
      const entry = (await store.list()).tasks.find((candidate) => candidate.id === task.id)
      return entry.run !== null && entry.run.status === 'done' ? entry : null
    })
    assert.equal(row.status, 'doing')
    await dispose()
  } finally {
    await dispose()
  }
})

test('services are found by property as well as by get()', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()

    // A context that only exposes services as properties, with no get() at all.
    const propertyOnly = { ...host.ctx, sessionController: host.controller, permissionPresets: host.presets }
    delete propertyOnly.get
    const byProperty = createRunner(propertyOnly, store)
    const first = await store.create({ title: '属性式宿主', cwd: 'C:/work/app' })
    const result = await byProperty.start(first.id)
    assert.equal(result.run.status, 'running')
    assert.equal(host.created.length, 1)

    // A context whose get() throws (inactive services do that) still works.
    const throwing = {
      ...host.ctx,
      sessionController: host.controller,
      get() {
        throw new Error('cannot get required service "sessionController" in inactive context')
      },
    }
    assert.equal(service(throwing, 'sessionController'), host.controller)
    assert.equal(service(host.ctx, 'nope'), undefined)
  } finally {
    await dispose()
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

test('a run that outlives the timeout is cancelled and marked failed', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    await runner.saveSettings({ timeoutMinutes: 0.02 })
    const task = await store.create({ title: '超时', cwd: 'C:/work/slow' })

    await runner.start(task.id)

    const failed = await waitFor(async () => {
      const row = (await store.list()).tasks.find((entry) => entry.id === task.id)
      return row.run !== null && row.run.status === 'failed' ? row : null
    }, 8000)
    assert.equal(host.agents.get('session-1').status, 'cancelled')
    assert.match(failed.run.message, /超时/)
    assert.equal(failed.run.attempts, 1)
  } finally {
    await dispose()
  }
})

test('a failed attempt is retried as far as the settings allow', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    await runner.saveSettings({ timeoutMinutes: 0.02, retries: 1 })
    const task = await store.create({ title: '重试', cwd: 'C:/work/retry' })

    await runner.start(task.id)
    await waitFor(() => (host.created.length === 1 ? true : null), 8000)

    // Fail the first attempt outright, so the retry does not ride on a timer.
    host.emit('agent/error', {
      agent: host.agents.get('session-1'),
      turn: 1,
      step: 1,
      error: new Error('boom'),
    })
    await waitFor(() => (host.created.length === 2 ? true : null), 8000)

    host.emit('agent/status', { agent: host.agents.get('session-2'), status: 'idle' })
    const done = await waitFor(async () => {
      const row = (await store.list()).tasks.find((entry) => entry.id === task.id)
      return row.run !== null && row.run.status === 'done' ? row : null
    })
    assert.equal(done.run.attempts, 2)

    // No third attempt: retries are exhausted.
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(host.created.length, 2)
  } finally {
    await dispose()
  }
})

test('a task waits for its blockers and starts when they finish', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    await runner.saveSettings({ autoRun: true })
    const blocker = await store.create({ title: '前置', cwd: 'C:/work/a' })
    const dependent = await store.create({ title: '后置', cwd: 'C:/work/b', blockedBy: [blocker.id] })

    await assert.rejects(runner.start(dependent.id), (error) => error.code === 'blocked')
    assert.equal(host.created.length, 0)

    const finished = await store.update({ id: blocker.id, status: 'done' })
    runner.onTaskChanged(finished)

    const started = await waitFor(async () => {
      const row = (await store.list()).tasks.find((entry) => entry.id === dependent.id)
      return row.run !== null && row.run.status === 'running' ? row : null
    })
    assert.equal(started.run.sessionId, 'session-1')
    assert.equal(started.blockedBy.length, 1)
  } finally {
    await dispose()
  }
})

test('an approval that stays inside the workspace is answered without the user', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '改代码', workspaceId: 'ws-1', workspacePath: 'C:/work/app' })
    const run = await runner.start(task.id)
    assert.equal(run.autoApprove, true)

    host.emit('session/event', { id: run.run.sessionId }, {
      type: 'tool/call',
      data: { callId: 'call-inside', name: 'write', arguments: { path: 'C:/work/app/src/a.ts' } },
    })
    host.emit('session/event', { id: run.run.sessionId }, {
      type: 'tool/call',
      data: { callId: 'call-relative', name: 'bash', arguments: { command: 'npm test' } },
    })

    let asked = false
    const next = async () => {
      asked = true
      return 'unavailable'
    }
    const inside = await host.emitAsync(
      'approval/request',
      { agent: { id: run.run.sessionId }, toolName: 'write', callId: 'call-inside' },
      next,
    )
    assert.deepEqual(inside, ['allowed-once'])
    const relative = await host.emitAsync(
      'approval/request',
      { agent: { id: run.run.sessionId }, toolName: 'bash', callId: 'call-relative' },
      next,
    )
    assert.deepEqual(relative, ['allowed-once'])
    assert.equal(asked, false)
    const stats = runner.stats()
    assert.equal(stats.autoApproved, 2, 'both in-workspace approvals are counted')
    assert.equal(stats.autoDelegated, 0)
    assert.equal(stats.autoSeen, 2, 'every request for our own session is counted')
  } finally {
    await dispose()
  }
})

test('an approval that leaves the workspace is refused, not forwarded', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '越界', workspaceId: 'ws-1', workspacePath: 'C:/work/app' })
    const run = await runner.start(task.id)

    for (const [callId, args] of [
      ['call-outside', { path: 'C:/windows/system32/config' }],
      ['call-parent', { command: 'cd .. && rm -rf app' }],
      ['call-home', { command: 'ls ~/secrets' }],
    ]) {
      host.emit('session/event', { id: run.run.sessionId }, { type: 'tool/call', data: { callId, name: 'bash', arguments: args } })
      let asked = false
      const results = await host.emitAsync(
        'approval/request',
        { agent: { id: run.run.sessionId }, toolName: 'bash', callId },
        async () => {
          asked = true
          return 'unavailable'
        },
      )
      assert.deepEqual(results, ['rejected'], 'the gate answers instead of handing it on')
      assert.equal(asked, false, 'nothing downstream gets to allow it')
    }
    const stats = runner.stats()
    assert.equal(stats.autoBlocked, 3, 'every out-of-workspace call is refused')
    assert.equal(stats.autoDelegated, 0)
    assert.equal(stats.autoApproved, 0)
  } finally {
    await dispose()
  }
})

test('auto approve can be turned off per task', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const task = await store.create({ title: '手动', workspaceId: 'ws-1', workspacePath: 'C:/work/app', autoApprove: false })
    const run = await runner.start(task.id)
    assert.equal(run.autoApprove, false)

    host.emit('session/event', { id: run.run.sessionId }, {
      type: 'tool/call',
      data: { callId: 'call-1', name: 'write', arguments: { path: 'C:/work/app/a.ts' } },
    })
    let asked = false
    const results = await host.emitAsync(
      'approval/request',
      { agent: { id: run.run.sessionId }, toolName: 'write', callId: 'call-1' },
      async () => {
        asked = true
        return 'unavailable'
      },
    )
    assert.deepEqual(results, ['unavailable'])
    assert.equal(asked, true)
  } finally {
    await dispose()
  }
})

test('an approval for a session this runner does not own falls through', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    let asked = false
    const results = await host.emitAsync(
      'approval/request',
      { agent: { id: 'session-someone-else' }, toolName: 'bash', callId: 'call-x' },
      async () => {
        asked = true
        return 'unavailable'
      },
    )
    assert.deepEqual(results, ['unavailable'])
    assert.equal(asked, true)
    const stats = runner.stats()
    // `autoSeen` counts what reached the gate, foreign sessions included: that
    // is the number that tells us whether the waterfall is wired up at all.
    assert.equal(stats.autoSeen, 1, 'the request is counted as seen')
    assert.equal(stats.autoApproved, 0, 'a foreign session is never approved')
    assert.equal(stats.autoDelegated, 0, 'a foreign session is not ours to delegate')
  } finally {
    await dispose()
  }
})

test('turning auto-run on picks up the tasks already waiting', async () => {
  const { store, dispose } = await makeStore()
  try {
    const host = makeHost()
    const runner = createRunner(host.ctx, store)
    const waiting = await store.create({ title: '早就躺在这', status: 'doing', workspaceId: 'ws-1', workspacePath: 'C:/work/app' })
    const finished = await store.create({ title: '跑过了', status: 'doing', workspaceId: 'ws-1', workspacePath: 'C:/work/app' })
    await store.update({
      id: finished.id,
      run: { sessionId: 'session-old', status: 'done', startedAt: 1, endedAt: 2, message: null, attempts: 1 },
    })

    assert.equal((await runner.settings()).autoRun, false)
    assert.equal((await store.list()).tasks.find(task => task.id === waiting.id).run, null)

    await runner.saveSettings({ autoRun: true })
    await waitFor(async () => (await store.list()).tasks.find(task => task.id === waiting.id).run?.status === 'running')

    const after = await store.list()
    assert.equal(after.tasks.find(task => task.id === waiting.id).run.status, 'running', 'the waiting task starts')
    assert.equal(after.tasks.find(task => task.id === finished.id).run.sessionId, 'session-old', 'a task that already ran is left alone')
  } finally {
    await dispose()
  }
})
