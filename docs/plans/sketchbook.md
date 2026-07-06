# The Sketchbook — capture, return, refine, remember

> A place to record a riff/motif/progression you're working on, keep its audio +
> tab + chords together as one named object, come back to it over time, and work
> on it with the Instructor. **Not a DAW** — a practice sketchbook wired into the
> app's existing sleep-aware review and one-fixable-thing coaching.

**Status:** Planned (revised after multi-review) · **Approach:** new resource (own `sketches.json` + plugin + tool) ·
**First cut:** Full MVP — Phase 0 + Phase 1 + the parity slice of Phase 2 ·
**Two ambitious bets confirmed:** (a) Instructor parity ships *in* the MVP; (b) the circle-of-fifths
engine is fully componentized (not iframed) as part of the MVP.

> **Multi-review note:** six specialized reviewers (architecture, patterns, agent-native, UX,
> data-integrity, performance) reviewed the first draft. Their findings are resolved inline
> below and traced in §12. Two corrections were load-bearing: the circle-of-fifths "engine"
> did not exist as a separable unit, and `fretting.js` cannot be a classic script.

---

## 1. Why this, why now

The app already contains ~80% of the parts, scattered across four tools with three
storage models that don't compose:

- **Licks** ([tools/licks.html](../../tools/licks.html), `student/licks.json`, `/api/licks`) — MIDI motifs + key/tags + **spaced-repetition drill**. No audio, no chords, no saved fretting.
- **Transcribe** ([tools/transcribe.html](../../tools/transcribe.html), [tools/analyze.js](../../tools/analyze.js)) — record → Basic Pitch → MIDI+timing → computed tab/fretboard. Fingering is **computed on the fly, never persisted**. Audio → `student/recordings/*.webm`.
- **Progression builder** ([tools/circle-of-fifths.html](../../tools/circle-of-fifths.html)) — roman-numeral progressions, comp-on-every-beat playback, drums, MIDI export, Instructor co-writer. **localStorage-only, ephemeral, unnamed, links to nothing.** It is a globals-heavy 1165-line page, *not* a reusable component (see §5).
- **Instructor** ([tools/coach.js](../../tools/coach.js), [server/coach-plugin.js](../../server/coach-plugin.js)) — reads/writes anything under `student/`; sees an open recording via `context.take`. Agent-native by filesystem convention, but *fluent* participation needs context injection + a taught write-contract (see §6).

**The gap:** no single named object unifies *audio take + saved tab/fretting + chord
progression + notes + Instructor collaboration* so you can revisit and refine it.

**Two keystone capabilities unlock most of the value:** (1) persisting fretting/tab
(deterministic + saved + editable); (2) a named, server-saved home for a riff-with-chords-and-audio.

**On-brand framing (PRODUCT-SPEC laws):** capture → return → refine → **remember**.
The "remember" step reuses the existing sleep-aware review loop (Law 3) — a deliberate-practice
tool, not a noodling toy.

---

## 2. The Sketch object

New resource `student/sketches.json`. Shape follows the app convention `{version, updated, <plural>:[]}`.

**Storage principle (resolves the 2 MB whole-document cap, finding #4):** the document stays
small. Audio lives out-of-line by path (as today). **Per-take Basic Pitch transcriptions are NOT
persisted** — they are transient, computed once to *seed* the tab, then discarded. The persisted
musical content is `tab.notes` (the chosen fretting) + `chords`. This also removes the two-arrays-
with-the-same-name drift (finding #9).

```jsonc
{
  "version": 1,
  "updated": "2026-07-04",
  "rev": 42,                            // monotonic write counter — optimistic-concurrency guard (§4d)
  "sketches": [
    {
      "id": "sk-a1b2c3d4",              // uid() (8-char base36, per repertoire.html) + "sk-" prefix
      "name": "descending 6/8 idea in C#m",
      "origin": "original",            // "original" | "from-song" — keeps sketches distinct from the repertoire queue
      "key": "C# minor",              // free text, licks.json convention; the tonic display authority
      "tempo": 96,                       // bpm (nullable)
      "status": "idea",               // idea | developing | parked | promoted  (renamed off "seed" — collided with the licks `seed` TAG)
      "tags": ["mayer", "verse-idea"],
      "takes": [                          // 0..n audio recordings, newest last. NO inline transcription.
        { "path": "student/recordings/2026-07-04-210631-ed96d3.webm",
          "added": "2026-07-04",
          "note": "first pass, rushed the turnaround" }
      ],
      "tab": {                            // the CHOSEN, persisted fretting — this IS "the fretting mapped out"
        "notes": [ { "midi": 59, "start": 0, "dur": 0.125, "string": 5, "fret": 4 } ],
        "seededFromTake": 0,             // which take (index) the auto-fingering came from, or null
        "editedByHand": false            // once true, re-seeding never clobbers it (§3 merge policy)
      },
      "chords": { /* the progression component's serialized state, verbatim (§5) */
        "tonic": "C#", "mode": "minor",
        "prog": [ { "label": "i", "semis": 0, "q": "min", "beats": 4, "accent": true },
                  { "label": "VI", "semis": 8, "q": "maj", "beats": 4 } ]
      },
      "log": [                            // freeform + Instructor annotations, newest last
        { "date": "2026-07-04", "by": "student", "text": "wants a darker turnaround" },
        { "date": "2026-07-04", "by": "instructor", "text": "try bVI instead of iv here" }
      ],
      "promotedTo": null,                // { kind:"lick"|"repertoire", id } — SOFT provenance hint; snapshot copy, not a live link
      "added": "2026-07-04"
    }
  ]
}
```

**Resolved modeling notes**
- **`chords` stores the progression component's native serialized state verbatim** (§5). The `q`
  vocabulary is the full builder domain — `maj, min, dom7, maj7, min7, m7b5, dim, dim7` — not just
  `maj/min` (finding #8). Any renderer/playback the sketch reuses must handle all of them; the
  component owns that, so there is genuinely zero translation once it's a component.
- **`tab.notes`** = `{midi,start,dur,string,fret}` (enriched). Transcription output elsewhere stays
  the raw licks shape `{midi,start,dur,amp}`; they are never conflated (finding #9).
- **`log[]` uses `date` (`YYYY-MM-DD`, the `today()` convention)** + array order — not ISO datetimes
  (finding, convention break). `by` ∈ `student|instructor`.
- **`promotedTo` is provenance only** — promotion is a snapshot *copy* into `licks.json`/`repertoire.json`;
  the pointer degrades gracefully to "promoted (may be stale)" if the target is deleted (finding #10).
- **`version`** — the reader refuses to overwrite a document whose `version` is newer than it
  understands (guards a stale client clobbering a migrated file).

---

## 3. Phase 0 — Deterministic, persisted fretting (the keystone)

**Problem:** transcribe's Viterbi fingering solver ([tools/transcribe.html](../../tools/transcribe.html) ~174–274)
recomputes positions each load and can differ run-to-run; nothing saves `{string, fret}`.

**Work**
1. **Determinism:** remove random tie-breaking; on equal DP cost prefer (a) lower mean fret,
   (b) fewer position shifts, (c) lower string number. Pure function of the note array. (Complexity
   is unchanged and bounded by short-take inputs — this is *not* claimed O(n); the DP is
   O(events × maxCands²) with capped candidates, and `eventCandidates` is O(events × notes); both
   fine for riff-length inputs — finding, performance.)
2. **Emit `{midi,start,dur,string,fret}`** from the solver and thread it through.
3. **Extract as an ESM module `tools/fretting.js`** — **not** a classic script. The solver
   transitively needs `@tombatossals/chords-db` and `tonal` (ESM npm imports) plus a cluster of
   transcribe internals (`toEvents`, `eventCandidates`, `chordVoicings`, `placeOn`, `algCandidates`,
   `meanFret`, `spanOf`, the `OPEN_MIDI/OPEN_SEMI/MAX_FRET` constants). Classic scripts are non-module
   `<script src>` and cannot `import`, so `fretting.js` is a normal ESM module that Vite bundles per
   page; transcribe.html and sketchbook.html both `import` it. **Do NOT add it to `CLASSIC_SCRIPTS`**
   (finding #3). Extract the fretboard/ASCII-tab **renderers** into the same module so sketchbook
   reuses them instead of a third copy (finding, patterns).
4. **Build on `theory.js` primitives** (`midiAt`/`noteAt`/`pcAt`, `OPEN_MIDI`) rather than a parallel copy.

**Tab recompute/merge policy (finding #9):** `tab` is authoritative once present. Auto-seeding runs
only when `tab.notes` is empty. Regenerating from a take is an explicit user action and is blocked
(or confirms) when `editedByHand` is true.

**Acceptance:** transcribe the same audio twice → identical tab. `assignPositions(notes)` is an
importable pure function returning stable `{string,fret}`. No visible change to transcribe beyond stability.

---

## 4. Phase 1 — The Sketch resource + tool (MVP)

### 4a. Server: `server/sketches-plugin.js`
Model on [server/licks-plugin.js](../../server/licks-plugin.js), with these **deliberate divergences from "clone verbatim"**:
- `DATA_REL = 'student/sketches.json'`, key `sketches`, plugin name `woodshed-sketches`.
- **Shape-checking `validate()`** (finding, data-integrity): `id`+`name` required; and *if present*,
  assert `takes` is an array of objects each with a string `path`, `tab.notes` is an array,
  `chords.prog` is an array, `log` is an array. Rejects malformed Instructor `write_file`s at the API
  boundary instead of crashing the workbench.
- **`rev` guard** (finding #1): a PUT must carry the `rev` it read; the server 409s on mismatch. Bump
  `rev` on every successful write. See §4d.
- **Cap:** raise to a comfortable ceiling now that transcriptions are out-of-line; still surface 413
  to the client (don't swallow it in a silent debounce).

**Audio upload — neutral shared endpoint (finding #11, boundary leak):** rather than reuse
`/api/coach/upload` (which carries coach semantics), extract a small `saveRecording(root, buf, ct)`
helper and expose `POST /api/recordings`; both the coach drawer and the sketchbook call it. Files still
land in `student/recordings/` and return `{ok, path}`.

**Registration is THREE sites, not one** (finding, architecture): the Vite plugin in
[vite.config.js](../../vite.config.js), the `loadMiddleware(...)` line in `server/serve.js`, **and** the
`path.startsWith('/api/sketches')` dispatch branch in `serve.js`. Miss the third and it works in dev
but 404s in prod.

### 4b. Tool: `tools/sketchbook.html`
Two views (mirror the licks/repertoire idioms and theme). **Progressive disclosure** — the workbench
uses a repertoire-style single-open accordion so the four panels don't all compete at once (finding, UX).

**List view** — cards: name, key, tempo, status chip, tag pills, take count, last-updated. "New
sketch". Filter by status/tag. Cards render a **bounded** thumbnail of `tab.notes` (capped node count),
not full arrays, and filtering must not re-serialize every card's full SVG (finding, performance).

**Detail/workbench view** — one sketch open, panels collapsible:
- **Record strip** — reuse [tools/mic.js](../../tools/mic.js) + MediaRecorder; on stop, upload via
  `/api/recordings`, then run Basic Pitch ([tools/analyze.js](../../tools/analyze.js)) to seed `tab.notes`
  (only if empty). **Transcription is on the main thread and takes seconds** — the strip MUST show a
  progress/"Transcribing…" state, a first-run model-load notice, and keep the rest of the workbench
  responsive (yield the thread); enforce the 120 s clip guard (findings #5, UX). Also fire the
  `context.take` bridge (§6) so a take recorded here is as legible to the Instructor as one in transcribe.
- **Tab panel** — render persisted `tab.notes` via the extracted renderers. Hand-correction: click a
  note → move to a valid string. Needs (finding, UX): a hover/cursor affordance, visible valid-target
  strings, single-level **undo / revert-to-auto**, and a persistent "auto-guess" label that flips when
  `editedByHand` becomes true.
- **Chords panel** — mount the **componentized progression builder** (§5), bound to `sketch.chords`.
- **Log panel** — freeform notes; append `{date, by:"student", text}`.
- **Autosave** — debounced `PUT /api/sketches` with the `rev` guard; inherits the licks/repertoire
  `.save-bar` (`✓ Saved` / `✗ Save failed`), plus a `beforeunload`/`visibilitychange` flush. Name
  defaults to an editable "Untitled · <date>" (or detected key) so capture is never gated on typing.

**Audio-engine arbitration (finding #7):** take playback and the chord-comp loop share the single
`ac()` `AudioContext` singleton ([tools/audio.js](../../tools/audio.js)); starting either engine stops the
other (one master transport), and the detail view tears both down on exit. No third scheduling
mechanism — take playback uses audio-clock scheduling like the drum engine.

**State coverage (finding #11):** define the **empty sketch** (name only, no take/tab/chords — the most
common first state and an explicit acceptance case), the **failed/zero-note transcription** path (keep
the uploaded audio, offer retry / lower thresholds), and **missing-recording** playback ("recording
unavailable", never a broken `<audio>`, never blocks the rest of the sketch).

### 4c. Nav + entry points
- Add sketchbook to the tool index / dashboard; surface recent/parked sketches on the dashboard so
  "return" is a click, not a hunt (finding, UX — this is the product thesis).
- In [tools/transcribe.html](../../tools/transcribe.html): a **"Save as sketch"** button beside "Save as lick",
  each with a one-line differentiator in its hint ("keep the audio + chords to develop later" vs the
  drill-oriented lick framing) so the choice is legible (finding, UX). Dedupe by source recording path
  to avoid silent lick/sketch duplication.

### 4d. Concurrency & data safety (new — resolves findings #1, #4, #10, #12)
- **Optimistic concurrency:** every writer (UI autosave *and* Instructor) carries the `rev` it read;
  server 409s on mismatch. On 409 the client re-GETs, re-applies its pending edit, retries. The `log`
  is treated append-only so a coach annotation and a tab edit merge instead of clobbering.
- **Re-read on coach activity:** after an Instructor turn (or on window focus), the open sketchbook
  re-fetches so a `write_file` edit isn't overwritten by the next debounced autosave.
- **Orphan handling:** persist the take reference (cheap PUT) *before* the expensive Basic Pitch step,
  so a crash mid-transcription still leaves a referenced recording. Document that any unreferenced
  `.webm` is a tolerated, harmless orphan (the shared `recordings/` dir makes automated sweeping unsafe).
- **Deletion:** deleting a sketch/take leaves its `.webm` in place (documented), and clears/rewrites
  `promotedTo` on the counterpart is best-effort only.

**Acceptance (MVP done):** record → transcribe (with visible progress) → auto-tab → name → save →
persists and reappears after reload with audio playable, tab stable, chords intact; build a
progression, it saves; an Instructor `write_file` during an open session is not lost; reopen a week
later and everything is there.

---

## 5. Componentizing the progression builder (MVP — the dominant cost)

**Reality (finding #2):** [tools/circle-of-fifths.html](../../tools/circle-of-fifths.html) is not an engine with a
seam — it's a 1165-line page whose playback (`playProg`/`scheduleProg`), inline `Drums`, voicing,
loop-ring, presets and co-writer all read/write module-global `let`s (`prog`, `selPos`, `selMode`,
`tempo`, `pBus`, `pPlaying`, `activePreset`) and call a shared `ac()` + `render()`. "Embedding" it is
a componentization, ~half the file.

**Work (chosen: full componentization now)**
1. Extract an **instance-scoped `ProgressionBuilder`** (a module that mounts into a container, holds
   its own state, exposes `getState()/setState()` and a `stop()` teardown). No module-global `let`s;
   no localStorage default-load; no debounced pref-save inside the component (finding, UX — otherwise
   the last-noodled prog leaks into every sketch).
2. **Reconcile with `theory.js`** — the component builds on the shared `QUAL`/`pcAt`/`midiAt` chord and
   fret primitives rather than keeping its parallel `VOICE`/`QUAL` tables (finding, patterns/architecture).
3. **Rewire both consumers:** the standalone `circle-of-fifths.html` mounts the component and wires its
   state to the existing `Stats.setPref` persistence; `sketchbook.html` mounts the same component and
   wires state to `sketch.chords`. Serialized state is exactly what the sketch stores (§2) — genuinely
   zero-translation *because* it's now one component. Preserve the full `q` vocabulary and `accent`.
4. Single shared `ac()` context; the component's transport participates in the master-stop rule (§4b).

**Acceptance:** `circle-of-fifths.html` behaves exactly as before (regression-checked: playback,
drums, presets, MIDI export, transpose); the same component renders inside the sketchbook and
round-trips `sketch.chords` without transposition/enharmonic drift.

> This is the single largest work item in the MVP. It is sequenced early (it gates the chords panel)
> and regression-tested against the standalone tool.

---

## 6. Instructor parity — in the MVP (chosen)

Agent-native is a core app law; the parity slice ships *with* the feature, not after (finding #6). The
Instructor gets file access for free (`student/` is a writable root), but **fluent** participation needs:

**In the MVP**
- **`context.sketch` injection** — when a sketch is open, the page sets `pendingExtra`/`window.__coach*`
  and fires `coach:open`, mirroring how transcribe passes `context.take` and how tone/identity pages
  inject their context. `coach.js buildContext()` gains a `sketch` key; `coach-plugin.js` gains a
  system-prompt paragraph documenting it (this is a client + prompt change, *not* "zero tooling" —
  finding, architecture).
- **Port the `context.take` bridge** into the record strip (§4b) so a take recorded in the sketchbook
  carries its structured transcription to the coach, same as transcribe.
- **Taught write-contract** in the system prompt + a row in [AGENT-INTERFACE.md](../../AGENT-INTERFACE.md)
  **shipped in the same PR that creates the file** (finding, freshness): the sketch shape, the `chords`
  `{tonic,mode,prog[]}` + full-`q` semantics, `id` generation (`sk-` + `uid()`), array-order-is-recency,
  the `rev` guard, and the honest limitation that the Instructor **cannot originate or transcribe
  audio** (no mic, no client-side Basic Pitch) — it annotates, proposes chords/sections, and edits
  `tab` only as *prose* advice unless a server refret helper exists.

**Fast-follow (Phase 2, not MVP)**
- A single **promote** primitive (tool or taught contract) available to *both* user and Instructor,
  with defined two-file ordering and `promotedTo` back-pointer.
- An **`open_sketch(id)`** client-bridge action (new `applyClientAction` case — no precedent today) so
  "open my C#m idea" surfaces the right sketch; establishes a reusable `open_<resource>` pattern.
- Optional server **`refret_sketch`** helper so the Instructor can actually apply a fingering fix.

## 7. Phase 3 — Remember over time (fast-follow)

Point the existing licks spaced-repetition engine (`Stats.record('licks', …)` / `schedule_review`) at
sketches — or at licks promoted from them — so "slowly remember little riffs" becomes the app's
sleep-aware review loop aimed at your own ideas. Reuses the drill UI wholesale.

---

## 8. Non-goals / deferred
- Full staff-notation engraving (VexFlow) — piano-roll + tab is enough.
- Bend/slide/vibrato capture — Basic Pitch is pitch+timing only; document the limit, don't fake it.
- Multi-track / overdub / mixing — sketchbook, not a DAW.
- Real-time (live) transcription — Law 8; don't gate the core loop on the frontier.
- A WebWorker for Basic Pitch — hard (TF.js + AudioContext decode want main thread); MVP yields the
  thread + shows progress instead.

## 9. Risks & mitigations
- **Componentization is the MVP's dominant cost and touches a beloved tool** → sequence it first,
  regression-test `circle-of-fifths.html` against current behavior before wiring the sketchbook.
- **Fingering is a guess** (audio can't reveal the string used) → best-guess + hand override + a
  persistent "auto-guess" label; the Instructor gives fingering advice as prose, not `{string,fret}`.
- **Concurrent writers** → `rev` guard + append-only log + re-read on coach activity (§4d).
- **Document growth** → transcriptions out-of-line, audio by path, bounded list render, 413 surfaced.
- **Scope creep toward a DAW** → the non-goals list is load-bearing; "capture/return/refine/remember"
  is the test for any addition.
- **Three-model overlap** → `origin` + snapshot-copy promotion (not live links) keep licks/repertoire/
  sketches distinct.

## 10. Files touched
**New:** `server/sketches-plugin.js`, `tools/sketchbook.html`, `tools/fretting.js` (ESM: solver +
renderers), `tools/progression-builder.js` (ESM: extracted component), `student/sketches.json` (seed
empty), `seed/student/sketches.json`.
**Modified:** [vite.config.js](../../vite.config.js) (register plugin; `fretting.js`/`progression-builder.js`
are ESM entries/imports — **not** `CLASSIC_SCRIPTS`), `server/serve.js` (mount plugin + dispatch branch;
extract `saveRecording` + `/api/recordings`), [tools/transcribe.html](../../tools/transcribe.html) (import
`fretting.js`; "Save as sketch"), [tools/circle-of-fifths.html](../../tools/circle-of-fifths.html) (mount the
extracted component), [tools/coach.js](../../tools/coach.js) (`context.sketch`; record-strip take bridge),
[server/coach-plugin.js](../../server/coach-plugin.js) (system-prompt paragraph), dashboard/nav.
**Docs:** [AGENT-INTERFACE.md](../../AGENT-INTERFACE.md) (sketches row — ships with the file).

## 11. Decisions locked
1. Home = **new Sketchbook resource** (not extend-licks, not fold-into-repertoire).
2. First cut = **Full MVP** = Phase 0 + Phase 1 + the parity slice of Phase 2.
3. **Instructor parity ships in the MVP** (`context.sketch` + take bridge + taught write-contract).
4. **Full componentization of the progression builder** in the MVP (not iframe).
5. Sketchbook holds **both** original ideas and riffs from songs, distinct from the repertoire queue (`origin`). *(pending explicit confirm)*
6. Fretting = **auto-guess + light manual override**, no full editor in MVP. *(pending explicit confirm)*
7. Per-take transcriptions are **transient** (seed the tab, not persisted); `tab.notes` + `chords` are the saved musical content.

## 12. Multi-review resolutions (traceability)
| Finding | Sev | Resolution |
|---|---|---|
| Concurrent whole-document write race | CRIT | `rev` optimistic-concurrency guard + append-only log + re-read on coach activity (§4a, §4d) |
| Circle-of-fifths "engine" not extractable | CRIT | Reframed as full componentization; §5 is now the dominant MVP work item, regression-tested |
| `fretting.js` can't be a classic script | CRIT | Made an ESM module (solver + renderers); removed from `CLASSIC_SCRIPTS` (§3, §10) |
| 2 MB cap can brick all saves | CRIT | Transcriptions out-of-line/transient; audio by path; bounded render; 413 surfaced (§2, §4a) |
| Basic Pitch blocks main thread, no loading state | CRIT | Progress state + model-load notice + 120 s guard + thread yield as acceptance criteria (§4b) |
| Agent-native parity violation | IMP | Parity slice pulled into MVP: `context.sketch`, take bridge, taught write-contract (§6) |
| Two audio engines collide / context leak | IMP | Single `ac()` singleton, master-stop rule, teardown on view exit (§4b) |
| `q` enum divergence | IMP | Full `q` vocabulary documented; owned by the component so translation is genuinely zero (§2, §5) |
| `tab.notes` vs transcription drift | IMP | Distinct shapes; transcription not persisted; explicit recompute/merge policy (§2, §3) |
| Referential integrity (orphans, dangling `promotedTo`) | IMP | Delete leaves audio (documented); promotion is snapshot copy; `promotedTo` degrades (§2, §4d) |
| Missing states (empty/failed/zero-note) | IMP | Empty-sketch + failed-transcription + missing-recording states defined (§4b) |
| Orphaned upload on partial success | IMP | Persist reference before transcription; tolerate documented orphans (§4d) |
| Loose validation crashes renderers | IMP | Shape-checking `validate()` on present optional fields (§4a) |
| `/api/coach/upload` boundary leak | IMP | Neutral `saveRecording` helper + `/api/recordings` (§4a) |
| Workbench overload | IMP | Single-open accordion / progressive disclosure (§4b) |
| serve.js 3-site registration | IMP | Called out explicitly (§4a) |
| Tab hand-edit UX (undo/affordance/label) | IMP | Affordances + revert-to-auto + auto-guess label (§4b) |
| Save-as-lick vs sketch ambiguity | INFO | Differentiator hints + dedupe by recording path (§4c) |
| `log[]` timestamp convention break | INFO | Uses `date`/`today()` + array order (§2) |
| `status:"seed"` collides with `seed` tag | INFO | Renamed statuses to `idea/developing/parked/promoted` (§2) |
| id scheme / `chordKeyTonic` dup / version upgrade / list render / naming default / dashboard entry / prog localStorage leak | INFO | `uid()`+prefix; tonic in `chords.tonic`; version guard; bounded render; default name; dashboard surfacing; component drops default-load (§2, §4b, §4c, §5) |
