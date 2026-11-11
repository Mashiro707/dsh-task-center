/**
 * Checks a stage document's verify commands before they are trusted.
 *
 * A verify command decides whether a stage is done, and the agent writes those
 * commands itself; a document that says `cd repo && ! grep -q repo/x.go` passes
 * because grep fails on a missing file and `!` turns that into success. These
 * checks catch the shapes that lie, before a wrong verdict is recorded.
 *
 * @module dsh-task-center/stage-doc
 */

import { existsSync } from 'node:fs'

/** Commands we expect a verify list to use; anything else is only a warning. */
const KNOWN_COMMANDS = new Set([
  'bash', 'bun', 'cargo', 'cat', 'cd', 'cmake', 'cmp', 'deno', 'diff', 'dotnet',
  'echo', 'eslint', 'find', 'git', 'go', 'grep', 'head', 'java', 'ls', 'make',
  'mvn', 'node', 'npm', 'npx', 'php', 'pnpm', 'prettier', 'pytest', 'python',
  'python3', 'rg', 'ruby', 'rustfmt', 'sed', 'sh', 'tail', 'test', 'tsc', 'wc',
  'yarn',
])

/** The first word after any leading `cd` and `!`. */
function firstWord(command: string): string {
  let rest = command.trim()
  for (;;) {
    const withoutBang = rest.replace(/^!\s*/, '')
    const cd = /^cd\s+("[^"]*"|'[^']*'|[^\s&|]+)\s*&&\s*/i.exec(withoutBang)
    if (cd !== null) {
      rest = withoutBang.slice(cd[0].length).trim()
      continue
    }
    return withoutBang.split(/[\s;|&]+/)[0] ?? ''
  }
}

/** The directory a command `cd`s into first, if any. */
function cdTarget(command: string): string | null {
  const match = /^\s*cd\s+("[^"]*"|'[^']*'|[^\s&|]+)\s*&&/i.exec(command)
  if (match === null) return null
  return match[1].replace(/^["']|["']$/g, '')
}

/** Path-like words in a command, used to notice references to files. */
function pathWords(command: string): string[] {
  const words = command.split(/[\s;&|()[\]{}'"`,]+/).filter(Boolean)
  return words.filter(word => !word.startsWith('-') && (/[/\\]/.test(word) || /\.[a-z0-9]{1,5}$/i.test(word)))
}

const VERIFY_BUILD = /(^|[;&|]\s*)(go\s+build|go\s+vet|npm\s+run\s+build|npm\s+build|pnpm\s+(run\s+)?build|cargo\s+build|mvn\s+(-\S+\s+)*compile|gradle\s+(build|compile\w*)|make|tsc)\b/
const VERIFY_TEST = /(^|[;&|]\s*)(go\s+test|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|cargo\s+test|pytest|node\s+--test|mvn\s+(-\S+\s+)*test|gradle\s+test|jest|vitest)\b/

const DANGEROUS = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+[~/]/, why: '递归删除根目录或家目录' },
  { pattern: /\bsudo\b/, why: '需要 sudo' },
  { pattern: /\b(mkfs|dd\s+of=\/dev\/)\b/, why: '直接写块设备' },
  { pattern: /\bchmod\s+-R\s+777\s+\//, why: '改根目录权限' },
  { pattern: /curl[^|]*\|\s*(ba|z)?sh/, why: '把网络内容直接交给 shell 执行' },
  { pattern: /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/, why: 'fork 炸弹' },
]

/**
 * Inspect a stage's verify commands.
 * @param {string[]} commands - the commands the document declares.
 * @param {string} root - the directory the commands run in.
 * @param {boolean} remote - true when `root` is a path on another machine.
 * @returns {{errors: string[], warnings: string[]}} what is wrong and what is odd.
 */
export function checkVerifyCommands(
  commands: string[],
  root: string,
  remote = false,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (commands.length === 0) {
    return { errors: ['阶段文档没有声明验收命令，没法判定这一步做完了。'], warnings }
  }
  for (const raw of commands) {
    const command = String(raw ?? '').trim()
    if (command === '') {
      errors.push('验收命令里有一条是空的。')
      continue
    }
    for (const rule of DANGEROUS) {
      if (rule.pattern.test(command)) errors.push(`验收命令会${rule.why}：${command}`)
    }
    const head = firstWord(command)
    if (head !== '' && !KNOWN_COMMANDS.has(head)) {
      warnings.push(`「${head}」不像是项目里常见的命令，确认它在目标机器上存在：${command}`)
    }
    const target = cdTarget(command)
    if (target !== null && !target.startsWith('/') && !/^[A-Za-z]:/.test(target)) {
      const base = target.split(/[\\/]/).filter(Boolean).pop() ?? target
      const tail = command.slice(command.indexOf('&&') + 2)
      if (base !== '' && new RegExp(`(^|[\\s"'])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`).test(tail)) {
        errors.push(
          `先 cd 进 ${target}，后面却又用 ${base}/ 开头的相对路径，实际找不到文件：${command}`,
        )
      }
      if (!remote && head !== '') {
        const absolute = root === '' ? target : `${root.replace(/[\\/]+$/, '')}${/^[\\/]/.test(root) ? '/' : '\\'}${target}`
        if (!existsSync(absolute)) errors.push(`cd 的目标目录不存在：${target}（在 ${root} 下）`)
      }
    }
    if (command.startsWith('!') && pathWords(command).length > 0) {
      warnings.push(
        `命令以 ! 取反，一旦路径写错会被当成「通过」：${command}`,
      )
    }
  }
  // `go test -run X` exits 0 when nothing matches, so a typo in the test name
  // would look exactly like a passing suite.
  for (const raw of commands) {
    const command = String(raw ?? '')
    if (!/\bgo\s+test\b/.test(command) || !/-run\b/.test(command)) continue
    if (/(\||&&|;)\s*grep\s+(-\w+\s+)*(--)?\s*'?"?---\s*PASS/.test(command)) continue
    errors.push(`go test -run 在没有匹配用例时也返回 0，必须断言通过，例如 -v … | grep -q -- '--- PASS:': ${command}`)
  }

  // Strength: a stage that only greps a file never proved it compiles or that
  // anything was tested. This warns instead of blocking, because doc-only stages
  // legitimately have nothing to build.
  const hasBuild = commands.some((entry: string) => VERIFY_BUILD.test(entry))
  const hasTest = commands.some((entry: string) => VERIFY_TEST.test(entry))
  if (!hasBuild) warnings.push('验收里没有编译/构建命令：改坏了能不能编译，建议先证明。')
  if (!hasTest) warnings.push('验收里没有跑测试的命令：建议至少跑一条单元测试或集成测试。')

  return { errors, warnings }
}

/**
 * Naming where the contract lives is what keeps a stage from inventing field
 * names: a document that says "see the API document" cannot be checked against
 * anything.
 * @param {{ contract?: string; steps?: string[] }} stage - the stage to screen.
 * @returns {{ errors: string[]; warnings: string[] }} what blocks approval.
 */
export function checkStageContract(stage: { contract?: string; steps?: string[] }): {
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []
  const contract = typeof stage.contract === 'string' ? stage.contract.trim() : ''
  const steps = Array.isArray(stage.steps)
    ? stage.steps.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    : []
  if (contract === '') {
    errors.push('没有写明契约来源：字段名、错误码以规格的哪一节为准（例如 4.2.30 / 4.2.16）')
  } else if (!/\d+\.\d+(\.\d+)*/.test(contract)) {
    errors.push('契约来源要写到条款号（例如 4.2.30），只写「接口文档」没法核对')
  }
  if (steps.length === 0) errors.push('没有步骤：文档要逐条写清这一步做什么，不能只给一句目标')
  else if (steps.length < 2) warnings.push('只有一个步骤，确认这确实是一件事')
  return { errors, warnings }
}
