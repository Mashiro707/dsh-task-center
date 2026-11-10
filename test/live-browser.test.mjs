/**
 * Real-browser regression for the panel, driven in the Edge that ships with
 * Windows. It is opt-in because it needs a browser and a display-capable box:
 * `DSH_LIVE_BROWSER=1 npm run test:browser`.
 *
 * What it buys over `browser.test.mjs`: jsdom does not run a layout engine, so
 * it cannot see a card that lost its radius, columns that stopped being equal,
 * or a dropdown list that renders behind a scroll container.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const enabled = process.env.DSH_LIVE_BROWSER === '1'

/** The board the panel will be given. */
function board() {
  const task = (id, status, title) => ({
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
  })
  // The first task carries one stage document so the markdown view can be driven.
  const first = task('t1', 'todo', '\u5199\u6587\u6863')
  first.stages = [
    {
      index: 0,
      title: '\u5206\u652f\u4e0e\u5de5\u7a0b\u5e95\u5ea7',
      goal: '',
      docPath: 'docs/t1/stage-1.md',
      scope: [],
      verify: [],
      status: 'awaiting-approval',
      message: null,
      output: null,
      startedAt: 1,
      endedAt: null,
    },
  ]
  first.stageIndex = 0
  return {
    tasks: [first, task('t2', 'doing', '\u6539\u63a5\u53e3'), task('t3', 'blocked', '\u7b49\u6743\u9650'), task('t4', 'done', '\u53d1\u7248')],
    trash: [],
    warning: null,
  }
}

/** Serve the bundle and one page; the panel fetches from window.__FIXTURE__. */
async function serve(bundleFile) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{--dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#eef1f5;
  --dsw-alias-label-primary:#1b1f24;--dsw-alias-label-secondary:#5b6470;--dsw-alias-label-tertiary:#8b94a1;
  --dsw-alias-border-l1:#e3e7ee;--dsw-alias-border-l2:#c9d1dd;--dsw-alias-brand-primary:#3b6cf0;
  --dsw-alias-brand-primary-hover:#2f5ad6;--dsw-alias-state-success-primary:#2a9d63;
  --dsw-alias-state-warn-primary:#c9821a;--dsw-alias-state-error-primary:#d24a4a}
  body{margin:0;font-family:system-ui,sans-serif}
  </style></head><body><div id="root"></div>
  <script type="module" src="/bundle.js"></script></body></html>`
  const server = createServer(async (request, response) => {
    if (request.url === '/bundle.js') {
      const body = await readFile(bundleFile)
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end(body)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('the panel lays out correctly in a real browser', { skip: !enabled && 'set DSH_LIVE_BROWSER=1' }, async () => {
  // Temp dirs can be write-protected on Windows, so build inside the package.
  const dir = fileURLToPath(new URL('./.live-build/', import.meta.url))
  await mkdir(dir, { recursive: true })
  const bundleFile = join(dir, 'bundle.js')
  await build({
    entryPoints: [fileURLToPath(new URL('./live/entry.js', import.meta.url))],
    bundle: true,
    format: 'esm',
    outfile: bundleFile,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  })

  const site = await serve(bundleFile)
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    if (process.env.DSH_LIVE_DEBUG === '1') {
      page.on('console', message => console.log('[console]', message.type(), message.text()))
      page.on('requestfailed', request => console.log('[failed]', request.url(), request.failure() && request.failure().errorText))
    }
      const markdown = [
        '# \u9636\u6bb5 1\uff1a\u5206\u652f\u4e0e\u5de5\u7a0b\u5e95\u5ea7',
        '',
        '> \u4efb\u52a1\uff1a\u5361\u5238\u4efb\u52a1\u3002\u672c\u6587\u6863\u7531\u89c4\u5212\u9636\u6bb5\u751f\u6210\u3002',
        '',
        '## \u76ee\u6807',
        '',
        '\u5728 `allynav-data-v2-master` \u4e0e `farminfo-biz` \u4e0a\u57fa\u4e8e **master** \u65b0\u5efa\u5206\u652f\uff0c\u5e76\u628a\u4ea4\u4ed8\u5305\u5185\u672a\u6267\u884c\u7684 DDL \u6458\u8981\u843d\u5230 `sql/` \u76ee\u5f55\u3002',
        '',
        '## \u5141\u8bb8\u6539\u52a8',
        '',
        '- `allynav-data-v2-master/api/coupon`',
        '- `farminfo-biz/internal/controller/coupon`',
        '',
        '```bash',
        'cd allynav-data-v2 && go build ./app/export/...',
        '```',
      ].join('\n')

    await page.addInitScript(payload => {
      window.__FIXTURE__ = payload
    }, {
      list: board(),
      workspaces: [{ id: 'ws-1', path: 'C:/work/one', title: '默认工作区' }, { id: 'ws-2', path: 'C:/work/two', title: '另一个' }],
      permissions: { options: [{ value: 'workspace-write', name: 'workspace-write' }], defaultPreset: 'workspace-write', available: true },
      settings: { autoRun: false, concurrency: 2, preset: 'auto', available: true },
      stageDoc: { path: 'docs/t1/stage-1.md', text: markdown },
    })
    await page.goto(site.url, { waitUntil: 'load' })
    await page.waitForSelector('.tc-board', { timeout: 15000 })

    assert.deepEqual(errors, [], 'the panel rendered without a runtime error')

    const columns = await page.$$eval('.tc-col', nodes => nodes.map(node => node.getBoundingClientRect().width))
    assert.equal(columns.length, 4, 'four columns')
    const spread = Math.max(...columns) - Math.min(...columns)
    assert.ok(spread <= 1.5, `columns are equal width (spread ${spread.toFixed(2)}px)`)

    const card = await page.$eval('.tc-card', node => {
      const style = window.getComputedStyle(node)
      return { radius: style.borderTopLeftRadius, size: style.fontSize }
    })
    assert.equal(card.radius, '10px', 'the card keeps its rounded corner')

    const sizes = await page.$$eval('.tc-card-title, .tc-card-meta, .tc-search', nodes =>
      nodes.map(node => Number.parseFloat(window.getComputedStyle(node).fontSize)),
    )
    assert.ok(sizes.length >= 3, 'the typography probes are on screen')
    for (const size of sizes) assert.ok(size === 12 || size === 13, `font size stays in 12/13 (saw ${size})`)

    // The dropdown list must escape its container: fixed positioning is what
    // keeps it out of the scrolling board.
    const button = await page.$('.tc-dd-btn')
    assert.ok(button !== null, 'the workspace picker rendered as a drawn dropdown')
    await button.click()
    await page.waitForSelector('.tc-dd-list', { state: 'visible', timeout: 5000 })
    // The position comes from a measurement taken after the first paint, so wait
    // for it instead of sampling the frame that happened to be on screen.
    await page.waitForFunction(
      () => {
        const node = document.querySelector('.tc-dd-list')
        return node !== null && window.getComputedStyle(node).position === 'fixed'
      },
      null,
      { timeout: 5000 },
    )
    const list = await page.$eval('.tc-dd-list', node => window.getComputedStyle(node).position)
    assert.equal(list, 'fixed', 'the list is portalled with fixed positioning')
    await page.keyboard.press('Escape')

    // The editor is a centred dialog sized to the viewport, not a narrow rail on
    // the right edge: this is the thing the drawer got wrong in real use.
    await page.click('.tc-card')
    await page.waitForSelector('.tc-drawer', { state: 'visible', timeout: 5000 })
    const dialog = await page.evaluate(() => {
      const node = document.querySelector('.tc-drawer')
      const box = node.getBoundingClientRect()
      return {
        width: box.width,
        left: box.left,
        right: box.right,
        height: box.height,
        body: node.parentElement === document.body || document.body.contains(node),
        radius: window.getComputedStyle(node).borderTopLeftRadius,
      }
    })
    assert.ok(dialog.width >= 700, `the dialog uses the width (${dialog.width.toFixed(0)}px)`)
    const centre = (dialog.left + dialog.right) / 2
    assert.ok(Math.abs(centre - 640) <= 2, `the dialog is centred (centre ${centre.toFixed(1)}px)`)
    assert.ok(dialog.height <= 860 * 0.9, `the dialog fits the height (${dialog.height.toFixed(0)}px)`)
    assert.equal(dialog.radius, '12px', 'the dialog is rounded')
    assert.ok(dialog.body, 'the dialog is portalled to the body')

    const dialogOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(dialogOverflow <= 1, `the dialog adds no overflow (${dialogOverflow}px)`)


    // The stage document has to read like a document, not like source text.
    await page.locator('.tc-stage-acts .tc-btn-quiet').first().click()
    await page.waitForSelector('.tc-md h2', { timeout: 10000 })
    const heading = await page.$eval('.tc-md h2', node => window.getComputedStyle(node).fontSize)
    assert.equal(heading, '13px', 'a heading is 13px, not source-sized')
    const quote = await page.$eval('.tc-md-quote', node => window.getComputedStyle(node).fontSize)
    assert.equal(quote, '12px', 'the document quote is 12px')
    const fence = await page.$eval('.tc-md-pre > code', node => node.textContent)
    assert.match(fence, /go build/, 'a fenced block keeps its command')
    const leftover = await page.$eval('.tc-md', node => node.textContent.slice(0, 24))
    assert.ok(!leftover.trimStart().startsWith('#'), 'no raw heading syntax left on screen')

    // Handy when someone wants to see what the dialog looks like without
    // opening the app: DSH_LIVE_SHOT=1 keeps a screenshot next to the bundle.
    if (process.env.DSH_LIVE_SHOT === '1') {
      // Outside the bundle directory: the test cleans that up on the way out.
      const shot = fileURLToPath(new URL('../.panel-shot.png', import.meta.url))
      await page.screenshot({ path: shot })
      console.log('[shot]', shot)
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`)
  } finally {
    await browser.close()
    await site.close()
    await rm(dir, { recursive: true, force: true })
  }
})
