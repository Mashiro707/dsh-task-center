import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const CLIENT = new URL('../client.js', import.meta.url)
const source = await readFile(CLIENT, 'utf8')

/**
 * The stylesheet body, extracted from the `const CSS = \` … \`` block.
 *
 * The file under test is the compiled artifact, so the terminator allows an
 * optional semicolon: tsc normalises ASI and appends one.
 */
const cssStart = source.indexOf('const CSS = `')
const cssTail = cssStart < 0 ? null : /\n`;?\n/.exec(source.slice(cssStart))
const css = cssTail === null ? '' : source.slice(cssStart + 'const CSS = `'.length, cssStart + cssTail.index)

test('the client half never reaches for a styles builtin it does not have', () => {
  assert.ok(css.length > 0, 'CSS block must exist')
  assert.equal(/typeof\s+styles\b/.test(source), false, 'no reference to an undefined global styles')
  assert.equal(/require\(\s*['"]styles['"]\s*\)/.test(source), false, 'styles is not in the module-table seed')
  assert.equal(/ctx\.effect\([^)]*insert/.test(source), false, 'stylesheet must not be wrapped in ctx.effect')
})

test('the package owns one idempotent data-plugin style tag', () => {
  assert.match(source, /dataset\.pluginCss\s*=\s*STYLE_ID/)
  assert.match(source, /dataset\.plugin\s*=\s*PACKAGE_ID/)
  assert.match(source, /document\.head\.appendChild\(tag\)/)
  assert.match(source, /document\.querySelector\(selector\)\s*===\s*null/, 'insertion must be idempotent')
})

test('the stylesheet keeps to alias tokens and literal-free colors', () => {
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'no hex colors')
  assert.equal(/\b(?:rgb|rgba|hsl|hsla)\(/.test(css), false, 'no functional literal colors')
  assert.equal(/\bbox-shadow\b/.test(css), false, 'no literal shadows')
  const named = /\b(?:red|blue|green|white|black|orange|purple|gray|grey|yellow)\b(?!-)/i
  assert.equal(named.test(css), false, 'no named colors')
  for (const [, token] of css.matchAll(/var\((--[a-z0-9-]+)\)/gi)) {
    if (token.startsWith('--tc-')) continue // package-local carrier, itself aliased to a theme token
    assert.ok(token.startsWith('--dsw-alias-'), `token ${token} is outside the alias set`)
  }
})

test('the type scale stays on 12px and 13px', () => {
  const sizes = new Set([...css.matchAll(/font-size:\s*([0-9.]+px)/g)].map((m) => m[1]))
  assert.ok(sizes.size > 0, 'stylesheet declares a type scale')
  for (const size of sizes) assert.ok(size === '12px' || size === '13px', `unexpected font-size ${size}`)
})

test('every requested visual affordance is present', () => {
  const required = [
    ['four equal columns', /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/],
    ['card radius', /\.tc-card\{[^}]*border-radius/],
    ['card hover lift', /\.tc-card:hover\{[^}]*translateY\(-1px\)/],
    ['priority bar', /\.tc-card::before\{[^}]*background:var\(--tc-priority\)/],
    ['column status dot', /\.tc-col-dot\{/],
    ['count badge', /\.tc-col-count\{[^}]*border-radius:999px/],
    ['tag chip', /\.tc-tag\{[^}]*border-radius:999px/],
    ['due overdue tone', /\.tc-tone-late\{[^}]*state-error-primary/],
    ['due today tone', /\.tc-tone-today\{[^}]*state-warn-primary/],
    ['search icon', /\.tc-search-icon\{/],
    ['drawer slide in', /@keyframes tc-slide-in\{from\{transform:translateX\(100%\)/],
    ['field groups', /\.tc-group\{/],
    ['list rows for trash', /\.tc-row\{/],
    ['focus ring', /:focus-visible\{outline:2px solid var\(--dsw-alias-brand-primary\)/],
    ['empty state', /\.tc-empty\{/],
    ['run button on cards', /\.tc-runbtn\{/],
    ['running pill', /\.tc-runpill\{[^}]*border-radius:999px/],
    ['running pulse', /@keyframes tc-pulse\{/],
    ['auto-run switch', /\.tc-toggle-on\{/],
    ['workspace chip', /\.tc-ws\{[^}]*border-radius/],
    ['inline directory row', /\.tc-inline\{[^}]*display:flex/],
    ['auto-approve switch', /\.tc-switch-track\{[^}]*border-radius:999px/],
    ['dropdown chrome removed', /select\.tc-input\{[^}]*color-scheme:light dark/],
    ['dropdown chevron', /select\.tc-input\{[^}]*background-image:linear-gradient\(45deg/],
    ['dropdown options themed', /select\.tc-input option\{[^}]*bg-layer-2/],
    ['number spinners hidden', /::-webkit-inner-spin-button\{-webkit-appearance:none/],
    ['date picker themed', /input\.tc-input\[type=date\]\{color-scheme/],
    ['one control height', /\.tc-input\{[^}]*height:30px/],
    ['buttons match the controls', /\.tc-btn\{[^}]*height:30px/],
    ['popup follows the app theme', /body\[data-ds-dark-theme\] select\.tc-input[^{]*\{color-scheme:dark\}/],
    ['themed scrollbars', /scrollbar-color:var\(--dsw-alias-border-l2\)/],
  ]
  for (const [label, pattern] of required) assert.match(css, pattern, `missing ${label}`)
})

test('the markup feeds the stylesheet its state', () => {
  assert.match(source, /'data-priority':\s*task\.priority/, 'cards must expose priority to the colour bar')
  assert.match(source, /'data-status':\s*props\.id/, 'columns must expose status to the header dot')
  assert.match(source, /className: 'tc-col-dot'/, 'column header needs the status dot element')
  assert.match(source, /className: 'tc-searchwrap'/, 'search field needs its icon wrapper')
  assert.match(source, /className: 'tc-group'/, 'drawer fields need grouping')
  assert.match(source, /className: 'tc-scrim'/, 'drawer needs a dismissible scrim')
})

test('every dropdown shares one control style', () => {
  const dropdowns = source
    .split("'select',")
    .slice(1)
    .map((chunk) => chunk.slice(0, 200))
  assert.ok(dropdowns.length >= 6, `expected the panel's dropdowns, found ${dropdowns.length}`)
  for (const dropdown of dropdowns) {
    assert.match(
      dropdown,
      /className:\s*'tc-input/,
      `a dropdown drops the shared control class: ${dropdown.split('\n')[1] ?? dropdown}`,
    )
  }
})

test('the panel can start and stop agent runs', () => {
  assert.match(source, /mutate\('run',/, 'cards must call the run endpoint')
  assert.match(source, /mutate\('cancelRun',/, 'stop button must call the cancel endpoint')
  assert.match(source, /call\('saveSettings',/, 'auto-run switch must persist through saveSettings')
  assert.match(source, /className: 'tc-toggle'/, 'the toolbar needs the auto-run switch')
  assert.match(source, /t\('noWorkspaceRun'\)/, 'a task without a workspace must explain itself')
})

test('a task picks its workspace and permission in the drawer', () => {
  assert.match(source, /call\('workspaces',/, 'the drawer needs the workspace list')
  assert.match(source, /call\('permissions',/, 'the drawer needs the permission presets')
  assert.match(source, /call\('createWorkspace',/, 'an unknown directory must be registrable inline')
  assert.match(source, /t\('field\.workspace'\)/, 'the drawer needs a workspace field')
  assert.match(source, /t\('field\.permission'\)/, 'the drawer needs a permission field')
  assert.match(source, /payload\.workspaceId = chosen\.id/, 'a quick-added task must carry its workspace')
  assert.match(source, /workspaceId: next\.workspaceId === '' \? null : next\.workspaceId/, 'the drawer must persist the workspace')
  assert.match(source, /permission: next\.permission === '' \? null : next\.permission/, 'the drawer must persist the permission')
  assert.match(source, /className: 'tc-ws'/, 'cards and rows need a workspace chip')
})

test('loading the client half really appends one package-owned stylesheet', () => {
  const head = []
  const document = {
    head: { appendChild: (el) => head.push(el) },
    createElement: (tagName) => ({ tagName, dataset: {}, textContent: '' }),
    querySelector: (selector) => {
      const wanted = /data-plugin-css="([^"]+)"/.exec(selector)
      if (wanted === null) return null
      return head.find((el) => el.dataset.pluginCss === wanted[1]) || null
    },
  }
  const React = {
    createElement: () => null,
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useCallback: (fn) => fn,
  }
  const requireStub = (specifier) => {
    if (specifier === 'react') return React
    throw new Error('client half required an unexpected module: ' + specifier)
  }

  const registrations = []
  const window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
  const run = new Function('window', 'document', 'require', source)
  run(window, document, requireStub)

  assert.equal(registrations.length, 1, 'client half registers exactly once')
  const plugin = registrations[0].factory(requireStub)
  assert.equal(registrations[0].id, 'dsh-task-center')

  const ctx = {
    locale: { register() {}, bind: () => (key) => key },
    slots: { inject() {}, register() {} },
  }
  plugin.apply(ctx)

  assert.equal(head.length, 1, 'one style tag reaches document.head')
  const tag = head[0]
  assert.equal(tag.tagName, 'style')
  assert.equal(tag.dataset.plugin, 'dsh-task-center', 'owned by the package id')
  assert.equal(tag.dataset.pluginCss, 'dsh-task-center/client.css')
  assert.match(tag.textContent, /\.tc-board\{display:grid/, 'the real stylesheet is what gets inserted')

  // A second run (HMR / remount) must not stack a duplicate tag.
  run(window, document, requireStub)
  registrations[1].factory(requireStub).apply(ctx)
  assert.equal(head.length, 1, 'stylesheet insertion is idempotent')
})

test('the browser half is authored in TypeScript and stays a script', async () => {
  const client = await readFile(new URL('../src/client.ts', import.meta.url), 'utf8')
  assert.equal(/^\s*(?:import|export)\s/m.test(client), false,
    'any import/export makes TypeScript emit a module, and the client loader cannot run one')
  assert.match(client, /window\.__ModuleLoader__\.load/, 'source registers through the module loader')

  const host = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(host, /export const inject/, 'host half keeps its Cordis entry')
  assert.equal(/declare\s+function\s+require/.test(host), false,
    'the host half imports node builtins instead of declaring a CommonJS require')
})

test('queues, timeouts and blockers are all visible in the panel', () => {
  assert.match(source, /tc-runpill-queued/, 'a parked run needs its own pill')
  assert.match(source, /t\('cancelQueued'\)/, 'a parked run must be cancellable')
  assert.match(source, /t\('field\.timeout'\)/, 'the toolbar exposes the timeout setting')
  assert.match(source, /t\('field\.retries'\)/, 'the toolbar exposes the retry setting')
  assert.match(source, /groupDeps/, 'the drawer needs a dependencies group')
  assert.match(source, /blockedBy: next\.blockedBy/, 'the drawer must save the blockers it picked')
  assert.match(css, /\.tc-blocker-on\{/, 'a picked blocker needs a visible state')
})

test('a stage shows its document and waits for an approval click', () => {
  assert.match(source, /t\('groupStages'\)/, 'the drawer needs a stages group')
  assert.match(source, /t\('awaitBadge'\)/, 'a waiting stage must say so on the card')
  assert.match(css, /\.tc-stagebar\{/, 'the card carries a stage progress bar')
  assert.match(css, /\.tc-stagelist\{/, 'the drawer lists the stages')
  assert.match(css, /\.tc-sdot-awaitingapproval\{/, 'a waiting stage needs its own dot colour')
  assert.match(css, /\.tc-doc\{/, 'the document preview needs a read-only surface')
  assert.match(source, /'approveStage'/, 'approving is a host call')
  assert.match(source, /'rejectStage'/, 'rejecting is a host call')
  assert.match(source, /onStageDoc/, 'the document is fetched, not inlined')
  assert.match(source, /onStageAction/, 'the drawer asks the page to approve or reject')
})

test('the card order survives numeric timestamps', () => {
  // The host stores epoch milliseconds, so the comparator must never call a
  // string method on them; the panel used to blank out as soon as two tasks
  // shared a due date and a priority.
  const built = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const start = built.indexOf('function bySchedule(a, b) {')
  assert.notEqual(start, -1, 'the comparator is part of the built artifact')
  let depth = 0
  let end = start
  for (let index = built.indexOf('{', start); index < built.length; index += 1) {
    if (built[index] === '{') depth += 1
    if (built[index] === '}') {
      depth -= 1
      if (depth === 0) {
        end = index + 1
        break
      }
    }
  }
  const snippet = built.slice(start, end)
  const factory = new Function(
    'const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };\n' +
      snippet +
      '\nreturn bySchedule;',
  )
  const bySchedule = factory()
  const older = { due: null, priority: 'normal', createdAt: 1000 }
  const newer = { due: null, priority: 'normal', createdAt: 2000 }
  assert.equal(bySchedule(older, newer) < 0, true, 'older tasks sort first')
  assert.equal(bySchedule(newer, older) > 0, true, 'newer tasks sort last')
  assert.equal(bySchedule(older, { ...older }), 0, 'equal stamps compare equal')
  const withDue = { due: '2026-01-01', priority: 'normal', createdAt: 5000 }
  assert.equal(bySchedule(withDue, older) < 0, true, 'a due task outranks an undated one')
})
