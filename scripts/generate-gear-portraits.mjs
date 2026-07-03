// Generate engraved gear portraits via xAI Grok Imagine — BOTH finishes:
//   light: sepia ink on warm cream paper            (BRAND.md Style C)
//   dark:  ivory + brass ink on espresso paper      (BRAND.md dark-surface variant)
// Guitars   → assets/guitars/<gearId>.png / <gearId>-dark.png
// Amp+pedals→ assets/gear/<gearId>.png   / <gearId>-dark.png
// Usage: node scripts/generate-gear-portraits.mjs [light|dark|both] [id ...]  (default: both, all)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const key = readFileSync(resolve(ROOT, '.env'), 'utf8').match(/XAI_API_KEY=(\S+)/)?.[1]
if (!key) { console.error('XAI_API_KEY not found in .env'); process.exit(1) }

// Subject lines anchor the model on each piece's real shape. No brand text — the
// engraving carries identity through silhouette and control layout instead.
const ITEMS = {
  // guitars (dir: guitars)
  'g-prs594':        { dir: 'guitars', desc: 'a PRS McCarty 594 electric guitar, double-cutaway carved figured-maple top, bird inlays on the fretboard, two humbucker pickups, four control knobs' },
  'g-suhr-classics': { dir: 'guitars', desc: 'a vintage 1960s Stratocaster electric guitar, double-cutaway contoured body, three identical narrow single-coil pickups in a pickguard, tremolo bridge, plain headstock with no logo or lettering' },
  'g-tele51':        { dir: 'guitars', desc: 'a 1951 Fender Telecaster electric guitar, single-cutaway slab body, black pickguard, two single-coil pickups, ashtray bridge' },
  'g-es355':         { dir: 'guitars', desc: 'a Gibson ES-355 semi-hollow electric guitar, double-cutaway archtop body with two f-holes, two humbuckers, split-diamond headstock inlay' },
  'g-000-28ec':      { dir: 'guitars', desc: 'a Martin 000-28 acoustic guitar, 14-fret auditorium body, herringbone top purfling, rosette detail' },
  'g-cordoba-c9':    { dir: 'guitars', desc: 'a Cordoba C9 classical nylon-string guitar, slotted headstock, fan-braced cedar top, mosaic rosette' },
  'g-martin-dm':     { dir: 'guitars', desc: 'a Martin dreadnought acoustic guitar, square-shouldered body, dot inlays, teardrop pickguard' },
  'g-gibson-sj':     { dir: 'guitars', desc: 'a 1942 Gibson Southern Jumbo acoustic guitar, round-shouldered slope dreadnought body, sunburst top, teardrop pickguard' },
  // amp + pedals (dir: gear)
  'a-bluesjr':      { dir: 'gear', desc: 'a Fender Blues Junior tweed combo guitar amplifier, lacquered tweed-covered cabinet, dark control panel strip with a row of knobs along the top, large woven speaker grille filling the front, leather strap handle on top' },
  'p-polytune':     { dir: 'gear', desc: 'a compact rectangular guitar tuner effects pedal, large blank display panel on the upper face, one small button each side, single round footswitch near the bottom' },
  'p-keeley-comp':  { dir: 'gear', desc: 'a compact guitar compressor effects pedal, four small knobs in a row across the top, small LED, single round footswitch' },
  'p-philtone':     { dir: 'gear', desc: 'a mini guitar compressor-sustainer effects pedal, narrow small enclosure, three small knobs, single round footswitch' },
  'p-morningglory': { dir: 'gear', desc: 'a guitar overdrive effects pedal, three knobs across the top, one tiny toggle switch, single round footswitch' },
  'p-bigmuff':      { dir: 'gear', desc: 'a large square vintage fuzz effects pedal, big sheet-metal enclosure, three large evenly spaced knobs across the top, single round footswitch at the bottom' },
  'p-univibe':      { dir: 'gear', desc: 'a vintage uni-vibe rotary-modulation effects pedal, wide enclosure with one large speed knob and two smaller knobs, single round footswitch' },
  'p-boonar':       { dir: 'gear', desc: 'a multi-head drum-echo emulation guitar effects pedal, wide enclosure, six knobs in two rows with a small rotary selector, single round footswitch' },
  'p-carboncopy':   { dir: 'gear', desc: 'a compact analog delay guitar effects pedal, three knobs across the top, tiny toggle, single round footswitch, small enclosure' },
  'p-rv6':          { dir: 'gear', desc: 'a Boss-style compact guitar reverb effects pedal, rectangular enclosure, four small knobs across the top, wide flat treadle footswitch plate covering the lower half' },
  'p-ge7':          { dir: 'gear', desc: 'a Boss-style compact graphic equalizer guitar pedal, seven small vertical sliders across the face, wide flat treadle footswitch plate covering the lower half' },
  'p-smartgate':    { dir: 'gear', desc: 'a compact noise-gate guitar effects pedal, one large knob, one small three-position switch, single round footswitch, MXR-style small enclosure' },
  'p-plumes':       { dir: 'gear', desc: 'a compact guitar overdrive effects pedal, three knobs in a row across the top, one small three-way toggle switch beside the knobs, single round footswitch, standard small enclosure' },
  'p-darkstar':     { dir: 'gear', desc: 'a wide ambient reverb guitar effects pedal, five knobs spread across the face, one small toggle switch, single round footswitch, larger rectangular enclosure' },
  'p-rc5':          { dir: 'gear', desc: 'a compact guitar looper effects pedal, a small rectangular LCD display screen on the upper face, one rotary knob beside the screen, two tiny buttons, one large wide footswitch treadle covering the lower half' },
  'p-crybaby':      { dir: 'gear', desc: 'a wah-wah rocker foot pedal for guitar shown from a three-quarter side angle, a large hinged treadle that pivots forward and back on a wide flat base, tall rounded toe end, chrome rocker plate on top' },
  'p-ts9':          { dir: 'gear', desc: 'a compact guitar overdrive effects pedal, three knobs in a row across the top, single round footswitch, smooth rounded-corner rectangular enclosure' },
  'p-crosstown':    { dir: 'gear', desc: 'a compact guitar fuzz effects pedal, three knobs across the top, single round footswitch, small standard enclosure' },
  'p-dukeoftone':   { dir: 'gear', desc: 'a compact guitar overdrive effects pedal, three knobs across the top, one small three-way toggle switch, single round footswitch, small MXR-style enclosure' },
}

const LIGHT = (d) =>
  `Antique patent-drawing style technical illustration of ${d}, full front elevation, ` +
  `accurate proportions for this exact piece of equipment, fine single-weight sepia-black ink linework ` +
  `on warm aged cream paper, 19th-century scientific engraving aesthetic, sparse cross-hatch shading, ` +
  `one small detail accented in warm amber-brass ink, generous empty margins, precise, calm, centered. ` +
  `Monochrome sepia ink except the single amber accent. No text, no letters, no numbers, no watermark, ` +
  `no signature, no frame border, not photorealistic, no gradients, no background objects.`

const DARK = (d) =>
  `Antique blueprint-plate style technical illustration of ${d}, full front elevation, ` +
  `accurate proportions for this exact piece of equipment, fine single-weight IVORY ink linework ` +
  `drawn on very dark espresso-brown paper, 19th-century scientific engraving aesthetic, sparse ` +
  `cross-hatch shading in ivory, one small detail accented in warm glowing brass-amber ink, generous ` +
  `dark margins, precise, calm, centered. Light lines on a dark ground — like a chalk-and-brass ` +
  `drawing on blackboard-dark paper. No text, no letters, no numbers, no watermark, no signature, ` +
  `no frame border, not photorealistic, no white background, no paper texture brighter than deep espresso.`

async function gen(id, item, finish) {
  const prompt = finish === 'dark' ? DARK(item.desc) : LIGHT(item.desc)
  const r = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'grok-imagine-image-quality', prompt, n: 1, aspect_ratio: '3:4', response_format: 'b64_json' }),
  })
  if (!r.ok) throw new Error(id + ' ' + finish + ': HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160))
  const b64 = (await r.json()).data?.[0]?.b64_json
  if (!b64) throw new Error(id + ' ' + finish + ': empty response')
  const dir = resolve(ROOT, 'assets', item.dir)
  mkdirSync(dir, { recursive: true })
  const out = resolve(dir, id + (finish === 'dark' ? '-dark' : '') + '.png')
  writeFileSync(out, Buffer.from(b64, 'base64'))
  console.log('saved', item.dir + '/' + id + (finish === 'dark' ? '-dark' : '') + '.png', Math.round(Buffer.byteLength(b64, 'base64') / 1024) + 'KB')
}

const args = process.argv.slice(2)
const finish = ['light', 'dark', 'both'].includes(args[0]) ? args.shift() : 'both'
const ids = args.length ? args : Object.keys(ITEMS)
for (const id of ids) {
  const item = ITEMS[id]
  if (!item) { console.error('unknown id:', id); continue }
  for (const f of finish === 'both' ? ['light', 'dark'] : [finish]) {
    // skip existing light guitar portraits (already curated) unless explicitly asked
    const out = resolve(ROOT, 'assets', item.dir, id + (f === 'dark' ? '-dark' : '') + '.png')
    if (f === 'light' && item.dir === 'guitars' && existsSync(out) && !args.length) { console.log('skip existing', id); continue }
    try { await gen(id, item, f) } catch (e) { console.error('FAILED', e.message) }
  }
}
