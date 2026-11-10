/**
 * End-to-end test of the browser half: the real `client.js` is loaded into
 * jsdom, mounted with React, and driven with clicks. The rest of the suite
 * checks the source text; this file checks what a user actually sees.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'

const built = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** One throwaway panel: a fresh window, a fresh mount point. */
async function mount(fixtures) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:51924/',
  })
  const { window } = dom
  const calls = []
  const fetched = []
  // Node defines some of these as getters, so plain assignment throws.
  const saved = new Map()
  const restoreGlobals = () => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[name]
      else Object.defineProperty(globalThis, name, descriptor)
    }
    saved.clear()
  }
  // Timers and notifications are captured so a poll can be driven by the test.
  const intervals = []
  const notifications = []
  window.setInterval = (callback) => {
    intervals.push(callback)
    return intervals.length
  }
  window.clearInterval = () => {}
  window.Notification = class {
    static permission = 'granted'
    constructor(title, options) {
      notifications.push({ title, ...options })
    }
  }
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'Notification']
  for (const name of names) {
    if (window[name] === undefined) continue
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true })
  }
  const previousFetch = globalThis.fetch
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT

  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = async (url, init = {}) => {
    const route = String(url).split('/task-center/api/')[1] ?? ''
    const body = init.body === undefined ? null : JSON.parse(init.body)
    const entry = { route, body }
    calls.push(entry)
    fetched.push(entry)
    const value = fixtures[route]
    if (value === undefined) {
      return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not-found', message: route } }) }
    }
    const answer = typeof value === 'function' ? value(body, entry) : value
    return { ok: true, status: 200, json: async () => ({ ok: true, value: answer }) }
  }

  try {
    let factory = null
    window.__ModuleLoader__ = { load: (module) => { factory = module.factory } }
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'navigator', built)(window, window.document, window.navigator)
    assert.ok(factory !== null, 'the module registered a factory')

    const plugin = factory((id) => (id === 'react' ? React : null))
    const registered = []
    const ctx = {
      slots: {
        inject: (_name, run) => run(),
        register: (options, component) => {
          registered.push({ options, component })
          return () => {}
        },
      },
      locale: { register: () => {}, bind: () => (key) => key },
      get: () => undefined,
    }
    plugin.apply(ctx)

    const shell = registered.find(entry => entry.options.name === 'main')
    assert.ok(shell !== undefined, 'the panel registered into the main slot')

    const container = window.document.getElementById('root')
    const root = createRoot(container)
    await React.act(async () => {
      root.render(React.createElement(shell.component))
    })
    // The panel fetches on mount; one more turn lets the promises settle.
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    return {
      window,
      document: window.document,
      container,
      calls,
      fetched,
      async click(element) {
        await React.act(async () => {
          element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
        })
        await React.act(async () => {
          await new Promise(resolve => setTimeout(resolve, 0))
        })
      },
      async settle() {
        await React.act(async () => {
          await new Promise(resolve => setTimeout(resolve, 0))
        })
      },
      /** Run whatever the panel registered on an interval, once. */
      async tick() {
        for (const callback of intervals) {
          await React.act(async () => {
            callback()
            await new Promise(resolve => setTimeout(resolve, 0))
          })
        }
        await React.act(async () => {
          await new Promise(resolve => setTimeout(resolve, 0))
        })
      },
      notifications,
      dispose() {
        React.act(() => {
          root.unmount()
        })
        dom.window.close()
        globalThis.fetch = previousFetch
        globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
        restoreGlobals()
      },
    }
  } catch (error) {
    globalThis.fetch = previousFetch
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
    restoreGlobals()
    throw error
  }
}

/** One board with one task in every column. */
function board(tasks) {
  return {
    tasks,
    trash: [],
    warning: null,
    workers: { queued: 0, running: 0, concurrency: 2 },
    autoRun: false,
    concurrency: 2,
  }
}

function task(id, status, title, extra = {}) {
  return {
    id,
    title,
    notes: '',
    status,
    priority: 'normal',
    due: null,
    tags: [],
    parentId: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    deletedAt: null,
    trashRoot: null,
    workspaceId: null,
    workspacePath: null,
    permission: null,
    autoApprove: false,
    cwd: null,
    workdir: null,
    blockedBy: [],
    run: null,
    stages: [],
    stageIndex: 0,
    ...extra,
  }
}

test('the panel renders one column per status and every card', async () => {
  const panel = await mount({
    list: board([
      task('t1', 'todo', '写文档'),
      task('t2', 'doing', '改接口'),
      task('t3', 'blocked', '等权限'),
      task('t4', 'done', '发版'),
    ]),
    workspaces: [],
    permissions: { options: [], available: false },
    settings: { autoRun: false, concurrency: 2, available: false },
  })
  try {
    const columns = panel.container.querySelectorAll('.tc-col')
    assert.equal(columns.length, 4, 'four columns are on screen')
    const cards = panel.container.querySelectorAll('.tc-card')
    assert.equal(cards.length, 4, 'one card per task')
    const titles = [...panel.container.querySelectorAll('.tc-card-title')].map(node => node.textContent)
    assert.deepEqual(titles, ['写文档', '改接口', '等权限', '发版'])
    assert.ok(panel.container.querySelector('.tc-search') !== null, 'the search box is there')
  } finally {
    panel.dispose()
  }
})

test('clicking a card opens the drawer with its stage list', async () => {
  const panel = await mount({
    list: board([
      task('t1', 'doing', '写文档', {
        workspacePath: 'C:/work',
        stages: [
          { index: 0, title: '读代码', goal: 'g', docPath: 'docs/a.md', scope: [], verify: [], status: 'done', message: null, output: null, startedAt: 1, endedAt: 2 },
          { index: 1, title: '改代码', goal: 'g', docPath: 'docs/b.md', scope: [], verify: [], status: 'awaiting-approval', message: null, output: null, startedAt: 1, endedAt: null },
        ],
        stageIndex: 1,
      }),
    ]),
    workspaces: [],
    permissions: { options: [], available: false },
    settings: { autoRun: false, concurrency: 2, available: false },
  })
  try {
    const card = panel.container.querySelector('.tc-card')
    assert.ok(card !== null, 'the card rendered')
    await panel.click(card)
    const drawer = panel.document.querySelector('.tc-drawer')
    assert.ok(drawer !== null, 'the drawer slid in')
    const stages = drawer.querySelectorAll('.tc-stage')
    assert.equal(stages.length, 2, 'both stages are listed')
    assert.match(drawer.textContent, /读代码/, 'the first stage title is shown')
  } finally {
    panel.dispose()
  }
})

test('the run button posts to the run route', async () => {
  const panel = await mount({
    list: board([task('t1', 'todo', '写文档', { workspaceId: 'ws-1' })]),
    workspaces: [],
    permissions: { options: [], available: false },
    settings: { autoRun: false, concurrency: 2, available: false },
    run: { id: 't1', status: 'doing', run: { sessionId: 's-1', status: 'running', startedAt: 1, endedAt: null, message: null, attempts: 1 } },
  })
  try {
    const card = panel.container.querySelector('.tc-card')
    await panel.click(card.querySelector('.tc-runbtn'))
    const posted = panel.fetched.find(entry => entry.route === 'run')
    assert.ok(posted !== undefined, 'the panel asked the host to run the task')
    assert.equal(posted.body.id, 't1')
  } finally {
    panel.dispose()
  }
})

test('a rejected stage offers to run again from its own row', async () => {
  const panel = await mount({
    list: board([
      task('t1', 'todo', '\u5199\u6587\u6863', {
        workspaceId: 'ws-1',
        workspacePath: 'C:/work',
        stages: [
          {
            index: 0,
            title: '\u8bfb\u4ee3\u7801',
            goal: 'g',
            docPath: '',
            scope: [],
            verify: [],
            status: 'draft',
            message: '\u6587\u6863\u88ab\u9a73\u56de\uff1a\u8303\u56f4\u5199\u9519\u4e86',
            output: null,
            startedAt: null,
            endedAt: null,
          },
        ],
        stageIndex: 0,
      }),
    ]),
    workspaces: [{ id: 'ws-1', path: 'C:/work', title: 'work' }],
    permissions: { options: [], available: false },
    settings: { autoRun: false, concurrency: 2, available: false },
  })
  try {
    const card = panel.container.querySelector('.tc-card')
    await panel.click(card)
    const button = panel.document.querySelector('.tc-stage-acts [data-action="rerun"]')
    assert.ok(button !== null, 'the rejected stage carries a re-run button')
    assert.equal(button.disabled, false, 'it is usable once the document is rejected')
    await panel.click(button)
    const posted = panel.fetched.find(entry => entry.route === 'run')
    assert.ok(posted !== undefined, 'the button asks the host to run the task again')
    assert.equal(posted.body.id, 't1')
  } finally {
    panel.dispose()
  }
})

test('a run that finishes while the panel is open raises a notification', async () => {
  let round = 0
  const running = task('t1', 'doing', '写文档', {
    workspaceId: 'ws-1',
    run: { sessionId: 's-1', status: 'running', startedAt: 1, endedAt: null, message: null, attempts: 1 },
  })
  const finished = task('t1', 'doing', '写文档', {
    workspaceId: 'ws-1',
    run: { sessionId: 's-1', status: 'done', startedAt: 1, endedAt: 2, message: null, attempts: 1 },
  })
  const panel = await mount({
    list: () => {
      round += 1
      return board([round === 1 ? running : finished])
    },
    workspaces: [],
    permissions: { options: [], available: false },
    settings: { autoRun: false, concurrency: 2, available: false },
  })
  try {
    assert.equal(panel.notifications.length, 0, 'a still-running task says nothing')
    await panel.tick()
    assert.equal(panel.notifications.length, 1, 'the finished run is announced once')
    assert.equal(panel.notifications[0].title, 'runDoneBadge')
    assert.match(panel.notifications[0].body, /写文档/)
    await panel.tick()
    assert.equal(panel.notifications.length, 1, 'and only once')
  } finally {
    panel.dispose()
  }
})

test('a stage document is rendered as markdown, not as raw text', async () => {
  const markdown = [
    '# \u9636\u6bb5 1\uff1a\u5206\u652f\u4e0e\u5de5\u7a0b\u5e95\u5ea7',
    '',
    '> \u4efb\u52a1\uff1a\u5361\u5238',
    '',
    '## \u76ee\u6807',
    '',
    '\u5728 `allynav-data-v2-master` \u4e0a\u65b0\u5efa **feature** \u5206\u652f\u3002',
    '',
    '- \u5141\u8bb8\u6539\u52a8\u4e00',
    '- \u5141\u8bb8\u6539\u52a8\u4e8c',
    '',
    '```bash',
    'go build ./...',
    '```',
  ].join('\n')
  const panel = await mount({
    list: board([
      task('t1', 'doing', '\u5361\u5238\u4efb\u52a1', {
        workspaceId: 'ws-1',
        stages: [
          { index: 0, title: '\u9636\u6bb5\u4e00', goal: 'g', docPath: 'docs/a/stage-1.md', scope: [], verify: [], status: 'awaiting-approval', message: null, output: null, startedAt: 1, endedAt: null },
        ],
        stageIndex: 0,
      }),
    ]),
    workspaces: [],
    permissions: { options: [], available: false },
    settings: { autoRun: false, concurrency: 2, available: false },
    stageDoc: { path: 'docs/a/stage-1.md', text: markdown },
  })
  try {
    const card = panel.container.querySelector('.tc-card')
    await panel.click(card)
    const view = panel.document.querySelector('.tc-stage-acts .tc-btn-quiet')
    assert.ok(view !== null, 'the stage offers its document')
    await panel.click(view)
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const doc = panel.document.querySelector('.tc-md')
    assert.ok(doc !== null, 'the document is a markdown block')
    assert.equal(doc.querySelectorAll('h2').length, 1, 'a level one heading becomes h2')
    assert.equal(doc.querySelectorAll('h3').length, 1, 'a level two heading becomes h3')
    assert.equal(doc.querySelectorAll('.tc-md-ul > li').length, 2, 'bullets become list items')
    assert.ok(doc.querySelector('.tc-md-code') !== null, 'inline code is marked up')
    assert.equal(doc.querySelector('.tc-md-pre > code').textContent, 'go build ./...', 'a fence keeps its lines')
    assert.ok(doc.querySelector('.tc-md-p strong') !== null, 'bold wraps a strong element')
    assert.ok(doc.querySelector('.tc-md-quote') !== null, 'a quote is its own block')
    assert.doesNotMatch(doc.textContent, /^#\s/m, 'no raw heading syntax is left on screen')
  } finally {
    panel.dispose()
  }
})
