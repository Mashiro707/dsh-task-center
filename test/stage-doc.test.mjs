import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkStageContract, checkVerifyCommands } from '../stage-doc.js'

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'tc-doc-'))
  await mkdir(join(dir, 'repo'), { recursive: true })
  await writeFile(join(dir, 'repo', 'main.go'), 'package main\n')
  return dir
}

test('a plain command in an existing directory passes', async () => {
  const dir = await workspace()
  try {
    const check = checkVerifyCommands(['cd repo && go build ./...'], dir)
    assert.deepEqual(check.errors, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a cd into a directory that does not exist is an error', async () => {
  const dir = await workspace()
  try {
    const check = checkVerifyCommands(['cd nope && go build ./...'], dir)
    assert.equal(check.errors.length, 1)
    assert.match(check.errors[0], /目标目录不存在/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cd into a repo and then using the repo prefix again is an error', async () => {
  const dir = await workspace()
  try {
    const check = checkVerifyCommands(['cd repo && ! grep -q TODO repo/main.go'], dir)
    assert.ok(check.errors.some(entry => /却.*又用 repo\//.test(entry)), check.errors.join('\n'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a negated command that reaches a path is only a warning', async () => {
  const dir = await workspace()
  try {
    const check = checkVerifyCommands(['! grep -q TODO main.go'], dir)
    assert.deepEqual(check.errors, [])
    assert.ok(check.warnings.some(entry => /取反/.test(entry)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('destructive commands are refused', () => {
  const check = checkVerifyCommands(['sudo rm -rf / --no-preserve-root'], '/tmp')
  assert.ok(check.errors.some(entry => /sudo|递归删除/.test(entry)))
})

test('an uncommon command is a warning, not an error', () => {
  const check = checkVerifyCommands(['frobnicate --check'], '/tmp')
  assert.deepEqual(check.errors, [])
  assert.ok(check.warnings.some(entry => /frobnicate/.test(entry)))
})

test('an empty verify list is refused', () => {
  const check = checkVerifyCommands([], '/tmp')
  assert.equal(check.errors.length, 1)
})

test('a remote root skips the directory existence check', () => {
  const check = checkVerifyCommands(['cd repo && go build ./...'], '/root/go/work', true)
  assert.deepEqual(check.errors, [])
})

test('a stage without a named contract cannot be approved', () => {
  const check = checkStageContract({ contract: '', steps: ['读代码'] })
  assert.equal(check.errors.length, 1)
  assert.match(check.errors[0], /契约来源/)
})

test('a contract has to name a clause, not just wave at the document', () => {
  const vague = checkStageContract({ contract: '接口文档', steps: ['读代码'] })
  assert.match(vague.errors.join(' '), /条款号/)
  const named = checkStageContract({ contract: '4.2.30 / 4.2.16，字段名以该节为准', steps: ['读代码', '改代码'] })
  assert.deepEqual(named.errors, [])
})

test('a stage without steps is refused, one step only warns', () => {
  const empty = checkStageContract({ contract: '4.2.30', steps: [] })
  assert.match(empty.errors.join(' '), /没有步骤/)
  const single = checkStageContract({ contract: '4.2.30', steps: ['就把这件事做完'] })
  assert.deepEqual(single.errors, [])
  assert.equal(single.warnings.length, 1)
})
