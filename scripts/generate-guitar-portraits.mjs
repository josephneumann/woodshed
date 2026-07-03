// Generate Gear Library guitar portraits via xAI Grok Imagine (BRAND.md Style C).
// Usage: node scripts/generate-guitar-portraits.mjs [gearId ...]   (no args = all)
// Reads XAI_API_KEY from .env; saves assets/guitars/<gearId>.png (3:4 portrait).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const key = readFileSync(resolve(ROOT, '.env'), 'utf8').match(/XAI_API_KEY=(\S+)/)?.[1]
if (!key) { console.error('XAI_API_KEY not found in .env'); process.exit(1) }

// One [INSTRUMENT] line per guitar — model names anchor the silhouette (BRAND.md Style C).
const GUITARS = {
  'g-prs594':      'a PRS McCarty 594 electric guitar, double-cutaway carved figured-maple top, bird inlays on the fretboard, two humbucker pickups, four control knobs',
  'g-suhr-classics': 'a vintage 1960s Stratocaster electric guitar, double-cutaway contoured body, three identical narrow white single-coil pickups in a white pickguard, tremolo bridge, plain headstock with no logo or lettering',
  'g-tele51':      "a 1951 Fender Telecaster electric guitar, single-cutaway slab body, black pickguard, two single-coil pickups, ashtray bridge",
  'g-es355':       'a Gibson ES-355 semi-hollow electric guitar, double-cutaway archtop body with two f-holes, two humbuckers, split-diamond headstock inlay',
  'g-000-28ec':    'a Martin 000-28 acoustic guitar, 14-fret auditorium body, herringbone top purfling, rosette detail',
  'g-cordoba-c9':  'a Cordoba C9 classical nylon-string guitar, slotted headstock, fan-braced cedar top, mosaic rosette',
  'g-martin-dm':   'a Martin dreadnought acoustic guitar, square-shouldered body, dot inlays, teardrop pickguard',
  'g-gibson-sj':   'a 1942 Gibson Southern Jumbo acoustic guitar, round-shouldered slope dreadnought body, sunburst top, teardrop pickguard',
}

const STYLE = (instrument) =>
  `Antique patent-drawing style technical illustration of ${instrument}, full front elevation, ` +
  `accurate body proportions and headstock shape for this exact model, fine single-weight sepia-black ` +
  `ink linework on warm aged cream paper, 19th-century scientific engraving aesthetic, sparse ` +
  `cross-hatch shading following the body contours, one small detail (a pickup or the rosette) ` +
  `accented in warm amber-brass ink, generous empty margins, precise, calm, centered. ` +
  `Monochrome sepia ink except the single amber accent. No text, no letters, no numbers, no watermark, ` +
  `no signature, no frame border, not photorealistic, no gradients, no background objects.`

async function generate(id, instrument) {
  const r = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'grok-imagine-image-quality',
      prompt: STYLE(instrument),
      n: 1,
      aspect_ratio: '3:4',
      response_format: 'b64_json',
    }),
  })
  if (!r.ok) throw new Error(id + ': HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200))
  const d = await r.json()
  const b64 = d.data?.[0]?.b64_json
  if (!b64) throw new Error(id + ': no image in response')
  const out = resolve(ROOT, 'assets/guitars', id + '.png')
  mkdirSync(resolve(ROOT, 'assets/guitars'), { recursive: true })
  writeFileSync(out, Buffer.from(b64, 'base64'))
  console.log('saved', out, Math.round(Buffer.from(b64, 'base64').length / 1024) + 'KB')
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(GUITARS)
for (const id of ids) {
  if (!GUITARS[id]) { console.error('unknown gearId:', id); continue }
  try { await generate(id, GUITARS[id]) }
  catch (e) { console.error('FAILED', e.message) }
}
