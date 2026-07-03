// Tool masthead MOTIFS via xAI Grok Imagine — replaces the pinned-paper plates.
// Borderless spot illustrations that MELT into the page via CSS blend modes:
//   light: sepia ink on PURE WHITE  → mix-blend-mode:multiply (white vanishes on cream)
//   dark:  ivory ink on PURE BLACK  → mix-blend-mode:screen   (black vanishes on espresso)
// Writes assets/plates/plate-<key>.png (light) + plate-<key>-dark.png.
// Usage: node scripts/generate-tool-motifs.mjs [light|dark|both] [key ...]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const key = readFileSync(resolve(ROOT, '.env'), 'utf8').match(/XAI_API_KEY=(\S+)/)?.[1]
if (!key) { console.error('XAI_API_KEY not found in .env'); process.exit(1) }

const MOTIFS = {
  ear:       'a human ear listening, with three elegant curved sound waves arriving and a small tuning fork beside it',
  fretboard: 'a fragment of a six-string guitar neck seen straight-on, four frets, a few scattered round note markers on the strings and one inlay dot',
  improv:    'an archery target with a single eighth-note sitting in the bullseye and a long curving arrow arcing in',
  progress:  'a vintage analog VU meter gauge, needle swept toward the high end, with a small arc of tick marks',
  reference: 'a small stack of three hardcover music books with a ribbon bookmark trailing out and a feather quill resting on top',
  technique: 'a guitarist\'s fretting hand arched over the strings of a guitar neck mid-stretch, elegant and anatomical',
  time:      'a classic pyramid metronome with its pendulum arm mid-swing and two faint arcs marking the beat',
}

const LIGHT = (m) =>
  `Fine single-weight sepia-brown ink line illustration of ${m}, vintage scientific-sketch style, ` +
  `sparse elegant linework, one small warm amber accent, centered with very generous empty margins, ` +
  `on a PURE WHITE background. No text, no letters, no numbers, no frame, no border, no filled shading, ` +
  `no background objects, not photorealistic.`

const DARK = (m) =>
  `Fine single-weight ivory ink line illustration of ${m}, drawn like chalk on a blackboard, ` +
  `sparse elegant linework, one small glowing warm brass-amber accent, centered with very generous ` +
  `empty margins, on a PURE BLACK background. Light lines on black only. No text, no letters, ` +
  `no numbers, no frame, no border, no background objects, not photorealistic.`

async function gen(k, finish) {
  const prompt = finish === 'dark' ? DARK(MOTIFS[k]) : LIGHT(MOTIFS[k])
  const r = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'grok-imagine-image-quality', prompt, n: 1, aspect_ratio: '1:1', response_format: 'b64_json' }),
  })
  if (!r.ok) throw new Error(k + ' ' + finish + ': HTTP ' + r.status + ' ' + (await r.text()).slice(0, 140))
  const b64 = (await r.json()).data?.[0]?.b64_json
  if (!b64) throw new Error(k + ' ' + finish + ': empty response')
  const dir = resolve(ROOT, 'assets', 'plates'); mkdirSync(dir, { recursive: true })
  const out = resolve(dir, 'plate-' + k + (finish === 'dark' ? '-dark' : '') + '.png')
  writeFileSync(out, Buffer.from(b64, 'base64'))
  console.log('saved plates/plate-' + k + (finish === 'dark' ? '-dark' : '') + '.png', Math.round(Buffer.byteLength(b64, 'base64') / 1024) + 'KB')
}

const args = process.argv.slice(2)
const finish = ['light', 'dark', 'both'].includes(args[0]) ? args.shift() : 'both'
const keys = args.length ? args : Object.keys(MOTIFS)
for (const k of keys) {
  if (!MOTIFS[k]) { console.error('unknown key:', k); continue }
  for (const f of finish === 'both' ? ['light', 'dark'] : [finish]) {
    try { await gen(k, f) } catch (e) { console.error('FAILED', e.message) }
  }
}
