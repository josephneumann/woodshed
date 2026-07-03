// First-run setup: copy seed/ into place for any file that doesn't exist yet.
// Runs automatically on `npm install` (postinstall) and is safe to re-run —
// it NEVER overwrites: your real practice data always wins.
//
// The published repo ships a blank slate in seed/; everything under student/,
// curriculum/, and the personal reference files is gitignored, so what you
// practice stays on your machine.
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED = join(ROOT, 'seed')

let copied = 0
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const src = join(dir, name)
    const rel = src.slice(SEED.length + 1)
    const dst = join(ROOT, rel)
    if (statSync(src).isDirectory()) { walk(src); continue }
    if (existsSync(dst)) continue
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    copied++
    console.log('[woodshed] seeded', rel.replace(/\\/g, '/'))
  }
}
if (existsSync(SEED)) walk(SEED)
if (copied) console.log(`[woodshed] ${copied} file(s) seeded — the shed is yours. Every one of them is gitignored: your practice stays local.`)
