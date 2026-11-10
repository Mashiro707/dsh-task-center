import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const out = []
let at = 0
while (true) {
  const index = buf.indexOf(magic, at)
  if (index < 0) break
  const frames = []
  let cursor = index + 4
  // Split off one frame: skip its header, then let zstd tell us how much it used.
  frames.push(cursor)
  try {
    const text = zstdDecompressSync(buf.subarray(index)).toString('utf8')
    out.push(text)
    break
  } catch (error) {
    break
  }
}

const text = out.join('')
const lines = text.split('\n').filter((line) => line.trim().startsWith('{'))
console.log('lines', lines.length)
const kinds = new Map()
for (const line of lines) {
  try {
    const event = JSON.parse(line)
    const key = String(event.type) + (event.data && event.data.type ? '/' + String(event.data.type) : '')
    kinds.set(key, (kinds.get(key) || 0) + 1)
  } catch {}
}
console.log([...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
for (const line of lines.slice(-6)) console.log('TAIL', line.slice(0, 220))
