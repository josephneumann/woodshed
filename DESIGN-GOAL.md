# /goal — The Woodshed, marquee-ready

> The bar: someone who has never seen this app should recognize a screenshot of ANY
> page as The Woodshed. Every page pixel-considered, both themes, desktop + mobile.
> Quiet, warm, disciplined — a tube amp in a dark workshop, not a SaaS dashboard.

## Identity pillars (what makes it OURS, not generic shadcn)

1. **Espresso & paper, not zinc.** The neutral palette warms toward the brand imagery:
   dark mode = espresso charcoal (hue ~26, not blue-zinc 240); light mode = warm paper.
   The hero photograph should feel like it *emerged from* the page background.
2. **Two voices of type.** Fraunces (display serif) = the craftsman's voice: wordmark,
   page titles, and **big display numerals** (BPM dial, stat numbers ≥24px — like a
   vintage amp faceplate). Inter = the working voice: everything else. Small stats use
   `font-variant-numeric: tabular-nums`.
3. **The fret line.** Our signature divider: a hairline with amber side-marker dots
   (frets 3·5·7 of a neck). Used once or twice per page to separate major sections.
   No other app has this; we use it with restraint.
4. **One amber moment per screen.** Amber = "this is the action." Primary button,
   active state, today's bar. Everything else stays quiet. If two things glow, neither does.
5. **The masthead.** Every tool page opens the same way: kicker
   (`THE WOODSHED · <DOMAIN>` in letterspaced caps, brand-strong), Fraunces h1,
   one-line sub, fret line. A designed opening, not an h1 dropped on a page.

## Pixel-polish checklist (every page must pass)

- [ ] Masthead present, correct domain kicker, sub ≤ 1.5 lines at 960px
- [ ] Exactly one amber-dominant element visible per viewport
- [ ] Big display numerals in Fraunces; small stats tabular Inter
- [ ] Panel padding rhythm consistent (18/22px), gaps 14/16px, no orphan margins
- [ ] Both themes: contrast ≥ AA for text, borders visible but quiet
- [ ] Mobile 375px: header one line, no horizontal scroll except fretboard wraps
- [ ] Hover/focus states on every interactive element; no dead cursors
- [ ] No emoji in chrome, icons optically aligned (−0.12em baseline)

## Domain kickers

Ear Trainer / Interval Reference / Transcribe → `EAR` · Fretboard / Scale / Triad /
Circle of Fifths → `FRETBOARD` · Metronome → `TIME` · Target-Tone → `IMPROVISATION` ·
Technique & Drills → `TECHNIQUE` · Resource / Gear → `REFERENCE` · Dashboard → `PROGRESS`

## Execution order

1. Shared layer (theme.css): warm palettes, masthead + fretline components, numeral rules
2. Per-page adoption (agent fleet): masthead, display numerals, fret lines, spacing sweep
3. Obsessive QA: screenshot every page × theme × viewport; fix until the checklist holds
