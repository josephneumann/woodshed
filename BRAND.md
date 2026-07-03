# Brand Identity — "The Woodshed"

> Brand for The Woodshed — a personal guitar practice workspace — deliberately subdued, not
> a product. The hub is **The Woodshed**; the AI coach inside it is **The Instructor**.

## The name
**The Woodshed.** Jazz slang for the place you go to practice until it's right — private,
disciplined, no audience. (Restored 2026-07-01 after a spell as "Joe's Guitar Hub"; the
assets and launcher were named for it all along.)

## Positioning & voice
- **One-liner:** Tools for deliberate and focused learning of guitar.
- **Personality:** quiet, personal, no hype.
- **Personality:** demanding but warm; a master craftsman, not a hype coach. Analog
  warmth (wood, worn frets, the amber glow of a tube amp) meets modern discipline
  (clean, measured, data-honest). No fluff, no filler praise — same voice as The Instructor.

## Visual system
- **Accent (brand):** warm amber / gold — `hsl(38 92% 50%)`. Used sparingly: primary
  action, logo, links, active states, "focus" markers. Already wired into `tools/ui.css`.
- **Neutrals:** shadcn **Zinc** (light + dark). Crisp, minimal, modern.
- **Imagery palette:** espresso & walnut wood browns, brass/amber light, deep charcoal
  shadows. Cinematic and intimate, never glossy stock.
- **Type:** **Inter Variable** for UI, **Fraunces Variable** (display serif) for the
  wordmark, heroes, and page titles — self-hosted in `public/fonts/`, tokens
  `--font-ui` / `--font-display` in `tools/theme.css`.
- **Logo mark:** **the pick** — a plectrum (point down) with the serif W
  (`assets/pick-mark.svg`). One mark everywhere: favicon, header chip, the coach
  launcher, and the chat avatar. The old woodshed-mark house glyph is retired.
- **Mood words:** warm · focused · crafted · disciplined · analog · uncluttered.

## Hero banner — how to use
The home page (`tools/index.html`) hero loads **`assets/hero-image.jpg`** (project
root). Current banner: a luxe rustic cabin with god-rays and three guitars (Grok
Imagine, 16:9). A dark left + bottom scrim sits over it for headline legibility, so:
- **Compose the subject on the RIGHT two-thirds**; keep the left third darker/simpler.
- Target **~1600×520 px (≈16:5)**, JPG. `background-size:cover` handles minor crop.

---

## Image-model prompts

### Primary — cinematic / warm (matches the banner)
```
Cinematic ultra-wide close-up of a vintage semi-hollow electric guitar — the f-hole,
body curve, and a few strings catching warm amber rim light. Deep espresso and walnut
wood tones, soft brass glow like a tube amp in the dark, low-key moody studio lighting,
shallow depth of field, fine grain, elegant and minimal. Subject sits in the right
two-thirds of the frame; the left third falls into soft darkness (space for text).
Editorial product photography, high detail, photorealistic. No text, no logos. 16:5
ultra-wide banner.
```

### Subject variations (swap the instrument to match your gear/goals)
- **Jazz/blues (McCarty 594 / ES-335 vibe):** "...a semi-hollow archtop, f-hole and figured maple top, smoky amber light..."
- **Country/Tele:** "...a worn butterscotch Telecaster, visible fret wear and player's-relic finish, warm workshop light..."
- **Acoustic/fingerstyle:** "...an acoustic guitar soundhole and rosette, fingers resting on the fretboard mid-phrase, golden hour light..."
- **Human/action:** "...a player's hand bending a string high on the neck, motion and intent, warm rim light, blurred background..."

### Light-mode variant (airier, if you prefer a bright banner)
```
Bright, airy ultra-wide photo of an acoustic guitar on warm light-oak wood, soft
natural window light, cream and honey tones, lots of negative space on the left,
minimalist Scandinavian product photography, subtle warm amber accents, clean and
calm. No text, no logos. 16:5 ultra-wide banner.
```

### Negative prompt (for models that support one)
```
text, words, letters, watermark, logo, signature, busy background, clutter, neon,
oversaturated, cartoon, illustration, lowres, blurry subject, deformed guitar,
extra strings, distorted proportions, people's faces
```

### Specs / placement
- Aspect **16:5**, ~**1600×520** (or 1536×512). Export JPG.
- Save to **`assets/hero-image.jpg`** (project root) — the hero (`tools/index.html`) picks it up automatically.
- If you want it tucked behind the scrim more or less, tell me and I'll tune the overlay.

---

## Illustration program — "Luthier Modern"

Two generated-asset styles, two jobs. Photography stays the hero voice; these are the
drawing voices. Full design rationale in DESIGN-GOAL.md.

### Style A — The Plate (patent-drawing engraving)
For tool mastheads, empty states, editorial art. Anchors the model on 19th-century
patent plates / scientific engraving — canonical styles it reproduces faithfully.

**Master prompt (change only the [SUBJECT]):**
```
Antique patent-drawing style technical illustration of [SUBJECT], fine single-weight
sepia-black ink linework on warm aged cream paper, 19th-century scientific engraving
aesthetic, orthographic elevation view, sparse cross-hatch and stipple shading,
thin dimension lines with small arrowheads, generous empty margins, one small detail
accented in warm amber-brass ink, precise, calm, minimal. No text, no letters,
no numbers, no watermark.
```

**Dark-surface variant** (full-bleed espresso backgrounds): append
`...drawn in ivory and brass ink on very dark espresso-brown paper, blueprint-plate style.`
Default treatment on dark pages is simpler: show the cream plate as a "pinned paper"
card — authentic to the workshop and one generation serves both themes.

**Subjects per domain** (figure captions are set in Fraunces via CSS, never generated):
- Ear → human ear beside a tuning fork, engraved sound-wave arcs
- Time → exploded mechanical metronome: pendulum, escapement, sliding weight
- Fretboard → guitar neck front elevation, nut-width dimension callout
- Technique → anatomical hand (tendons visible, Gray's-Anatomy style) over a fretboard
- Improvisation → archtop f-hole close study with a dotted melodic path
- Reference → luthier bench tools in a row: calipers, fret file, string winder
- Progress → soundhole rosette pattern, one ring section magnified

### Style B — The Stamp (linocut ceremony marks)
For badges, streaks, mastery burns — the ceremony layer. Pressed, not drawn.

```
Hand-carved linocut stamp print, circular badge composition of [SUBJECT], single
burnt-sienna ink on cream paper, bold carved linework with visible hand-cut texture,
slightly imperfect edges like a rubber stamp impression, folk workshop aesthetic,
centered, generous margin. No text, no letters, no numbers.
```

Subjects: a tiny woodshed/cabin, crossed drumsticks→(use: crossed picks), a coiled
guitar string, a flame (streaks), a metronome silhouette, laurel of guitar strings.

### Style C — Guitar portraits (gear library)
Accurate instrument likenesses are an image-model job, not hand-drawn SVG (retired the
Tone Studio silhouettes 2026-07-02 — shapes never landed). Portraits live in the **Gear
Library**; Tone Studio stays functional/compact.

**Master prompt (swap the [INSTRUMENT] line per guitar):**
```
Antique patent-drawing style technical illustration of [INSTRUMENT], full front
elevation, accurate body proportions and headstock shape for this exact model, fine
single-weight sepia-black ink linework on warm aged cream paper, 19th-century
scientific engraving aesthetic, sparse cross-hatch shading following the body contours,
one small detail (pickup or rosette) accented in warm amber-brass ink, generous empty
margins, precise, calm. No text, no letters, no numbers, no watermark.
```

**[INSTRUMENT] lines for the current inventory** (keep the model name in the prompt —
it anchors the silhouette):
- `a PRS McCarty 594 electric guitar, double-cutaway carved figured-maple top, bird inlays, two humbuckers`
- `a Suhr Classic S electric guitar, Stratocaster-style double-cutaway body, three single-coil pickups`
- `a Fender American Vintage II Telecaster, single-cutaway slab body, butterscotch, black pickguard`
- `an Epiphone ES-355 semi-hollow electric guitar, double-cutaway archtop with f-holes, Bigsby optional`
- `a Martin 000 acoustic guitar, 14-fret auditorium body, herringbone rosette`
- `a Cordoba nylon-string classical guitar, slotted headstock, fan-braced cedar top`
- `a Martin DM dreadnought acoustic guitar, square-shouldered body`
- `a Gibson Southern Jumbo acoustic guitar, round-shouldered slope dreadnought, sunburst`

Generate ~3:4 portrait, PNG, save to **`assets/guitars/<gearId>.png`** (gearId from
`student/gear.json`, e.g. `assets/guitars/g-mccarty.png`). The Gear Library will show
them when present; anything without an image falls back to the pick mark.

**Status (2026-07-02): the full program is GENERATED** via `scripts/generate-gear-portraits.mjs`
(xAI Grok Imagine). Every piece exists in BOTH finishes:
- light `<id>.png` (sepia on cream) and dark `<id>-dark.png` (ivory + brass on espresso —
  the dark-surface variant above). Guitars in `assets/guitars/`, amp + pedals in `assets/gear/`.
- `scripts/make-gear-thumbs.py` builds `<name>-thumb.png` from each plate: auto-trimmed to
  the drawn subject, 168×224, contrast-tuned for dark. **Pages use thumbs at row size and the
  full plate in the lightbox** — full plates have generous margins and mud out below ~60px,
  so regenerate thumbs whenever a plate changes.
- The app swaps finishes with the theme (gear library, hub current-guitar card, hero).
- Hero: `assets/plates/hero-plate-2.png` / `hero-plate-dark-2.png` (16:9, workshop wall;
  dark one carries a pinned cream sheet on the left third for the headline). Originals kept.

### Negative prompt (both styles)
```
photograph, photorealistic, 3D render, gradients, glow, neon, cartoon, anime, flat
vector, thick uniform outlines, text, letters, numbers, watermark, signature, frame
border, busy background, color other than described
```

### Workflow (Nano Banana / Gemini image)
1. Generate ONE master plate (the metronome is a good calibration subject); iterate
   until line weight + paper feel right.
2. Feed the master back as a style-reference image for every other asset: "same style,
   same paper, same line weight — now [SUBJECT]". Batch the whole set in one session.
3. Generate 4:3 or 1:1 at the highest available resolution; export PNG; save to
   `assets/plates/` and `assets/stamps/`.
4. Keep amber accents rare — if the model over-colors, say "monochrome sepia ink except
   one amber dimension line."
