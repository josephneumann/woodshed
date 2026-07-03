# Improvement Plan — toward the platonic Guitar Hub

> Written 2026-07-01 after a full audit (4 deep code reviews + visual pass).
> Goal: turn the tools from good standalone toys into one coherent, measuring,
> adaptive practice system — the instrument panel The Instructor coaches from.

## The thesis

The system's premise (README): *"the tools generate the numbers that go into the log."*
Today they mostly don't — trainer stats die on reload, the metronome forgets its BPM,
and nothing the tools measure ever reaches `student/` or the dashboard. Fixing that
data spine, plus the handful of real bugs, moves this further than any visual polish.

## Phase 1 — Foundation (hand-built, everything depends on it)

New shared module **`tools/stats.js`** (classic script, global `Stats`), loaded by every tool:

- **Per-day, per-tool aggregates** in localStorage (`practiceStats`): answered/correct/skipped,
  best streak, response-time sums, per-key accuracy (`byKey`, e.g. per interval), clean-tempo
  records, first/last activity timestamps (→ minutes practiced).
- **Adaptive-difficulty helpers**: `Stats.weakKeys(tool)` returns the keys you're worst at so
  trainers can bias question selection toward weaknesses.
- **`Stats.streakDays()`** — consecutive practice days, for the hub.
- **`Stats.export()`** — one JSON blob for The Instructor (bridges to `student/progress-data.json`).
- **Prefs API** (`Stats.getPref/setPref`) — every tool persists its settings (metronome BPM,
  circle key, trainer options) under one namespaced scheme.
- Shared `DOMAINS` / `DOMAIN_SHORT` constants (fixes hub "Tech" vs dashboard "Technique" drift).

Plus: `SCALE_DEFS` added to `theory.js`; global mute (persisted) in `audio.js` with a
speaker toggle in the header (`header.js`).

## Phase 2 — Parallel tool upgrades (Sonnet agent team, one agent per file)

| Tool | Bug fixes | Upgrades |
|---|---|---|
| Ear Trainer | chord-pair fallback | persistent stats, **weak-interval adaptive weighting**, skip button, per-interval mastery readout, responsive fretboard |
| Fretboard Trainer | — | persistent stats (incl. avg response time trend), skip, adaptive prompt when you're fast, responsive fretboard |
| Triad Trainer | infinite-retry hang | persistent stats, responsive fretboard |
| Target-Tone Trainer | overlapping-playback timers | activity tracking, responsive fretboard |
| Scale Trainer | — | degree-drill stats, always-visible relative key, responsive fretboard |
| Metronome | visual/audio flash sync | **settings persistence**, Worker-driven scheduler (background-tab safe), **tempo-ramp mode**, session timer, accuracy-gate tempos logged → dashboard |
| Circle of Fifths | — | state persistence, preset active states, **click track under progression playback** |
| Technique Drills | — | session-completion **history log**, random-drill button, drill completions → stats |
| Transcribe | absolute model path; double-TFJS load | **loop + 50–150 % speed practice playback** |
| Gear Library | stale current-guitar precedence | cleaner file⇄local sync messaging |
| Hub (index.html) | orphaned plan checkboxes; gear dropdown when fetch fails | practice-streak + today's-minutes strip from Stats, dashboard link, mobile header fix (theme.css) |
| Dashboard | — | **practice-activity panel from Stats**: sparkline trends, per-tool minutes, tempo records finally populated, weak-spots table |

## Phase 3 — Verify & ship

Run the app, screenshot every page light+dark+mobile, check console, fix breakage, commit.

## Later (not this pass)

Practice-session engine (guided walk through today's plan), ear-training unlock ladder,
backing-track/looper tool, transcribe take-archive in IndexedDB, voice-leading drill,
new drills (hybrid picking, finger rolling, tremolo, muting).
