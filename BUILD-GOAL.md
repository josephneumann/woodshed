# /goal — Ship the Woodshed spec, end to end, verified

> Execute PRODUCT-SPEC.md build order 1–6 in one campaign. Nothing counts as done
> until it runs in the browser, round-trips real data, and passes the verification
> protocol below. Companion: PRODUCT-SPEC.md (what/why), DESIGN-GOAL.md (how it looks).

## Definition of done (the whole checklist, no partial credit)

**A. The Instructor, embedded (spec pillar 1)**
- [x] Local sidecar inside the Vite dev server: `POST /api/coach` streams Sonnet
      (claude-sonnet-4-6) responses over SSE; key from `.env` (never in client code)
- [x] Agent tool loop server-side: read files (student/, curriculum/, reference/),
      write files (student/ ONLY, path-traversal-proof), so the coach reads PROFILE/
      PROGRESS-LOG/plan and can log sessions & update the plan
- [x] System prompt = SYSTEM-PROMPT.md + workspace map, prompt-cached (stable prefix
      first, cache_control on the last stable block)
- [x] Client stats bridge: every chat message carries page context + Stats digest
- [x] Conversation history persists server-side (student/coach-history.json,
      gitignored) — the coach remembers across pages and across days
- [x] coach.js on every page via header.js: amber dock chip → slide-over drawer
      (streaming chat, Woodshed-styled) → pop-out to coach.html full page
- [x] `window.WoodshedCoach.open(extra)` + `coach:open` event so tools can summon
      the coach with context (Transcribe debrief uses this)
- [x] Web discovery: server-side web_search tool (max 5 uses/turn, pause_turn
      handled) + add_resource tool appending coach-vetted finds to
      reference/resource-library.json (dedup by URL, ask-before-add etiquette)

**B. Take system (pillar 2)**
- [x] Transcribe: every analysis auto-saves a take to IndexedDB (report, notes
      summary, metadata; audio blob when available)
- [x] "My takes" panel: list, reload/replay a past take, view its report
- [x] "Debrief with the Instructor" button on any take → opens coach drawer with
      the take report as context

**C. Scheduler v1 — sleep-aware confirmations (pillar 3)**
- [x] `Stats.review` API in stats.js: add / due / complete / all; items due ≥ next
      calendar day (never same-day re-test); attempts tracked
- [x] Metronome: accuracy-gate pass enqueues a confirmation for tomorrow; a due
      confirmation shows a one-click banner; re-pass marks the tempo CONFIRMED
- [x] Ear + fretboard trainers: weak keys (<60% on ≥6 attempts) enqueue reviews;
      recovering to ≥80% completes them
- [x] Scale trainer: mastery marks enqueue next-day confirmation
- [x] Hub: "Tomorrow's bench" card lists due items with deep links

**D. Quality metrics & instruments (pillar 4)**
- [x] `Stats.improvements(nDays)`: clean-tempo delta, per-tool accuracy delta
      (week vs prior week), confirmations earned — the "what improved" engine
- [x] Hub: flame streak chip REPLACED by a neutral 14-day practice-pattern
      calendar + "This week" improvements line (law 4: no guilt machinery)
- [x] Dashboard: instrument-cluster panel — VU minutes meter, accuracy dial,
      confirmation counter wheel (SVG, faceplate numerals), headlined by
      "What improved this week"; 30-day pattern calendar; activity chart demoted below

**E. Ceremony (pillar 5)**
- [x] Scale trainer mastery = 3-ring SVG rosettes (ring 1: marked; ring 2: drill
      evidence; ring 3: next-day confirmation) — rings ink on EVIDENCE only

**F. Recital (pillars 6–7, v1)**
- [x] Dashboard "Recital page" button: print-friendly summary (improvements,
      confirmed tempos, rosettes, takes list) in Woodshed style

## Verification protocol (run after build; every item must pass)
1. `npm run dev` boots clean; `/api/coach` health responds
2. Every page × dark + light: zero console errors, masthead intact
3. LIVE coach round trip: send a real message, watch SSE stream, verify reply
4. Tool-write proof: ask the coach to append a practice note; diff the file on disk
5. Scheduler loop: force a due review (backdate), confirm via the tool, watch it
   complete and the confirmation land in stats + dashboard counter
6. Take loop: run transcribe self-check → take saved → debrief opens coach with
   take context
7. Mobile 375px + desktop screenshots of: hub (bench card + calendar), dashboard
   cluster, coach drawer open, rosettes
8. `git status` clean at the end; no secrets in any committed file

## Execution shape
- Wave 1 (parallel, Opus): [A] coach vertical slice · [B] stats.js scheduler +
  improvements core (the contract everyone else consumes)
- Wave 2 (parallel, Sonnet + Opus for dashboard/transcribe): metronome, ear,
  fretboard, scale, hub, dashboard, transcribe
- Wave 3 (orchestrator): live verification protocol, fixes, commits

## Contracts (agents code against these, not vibes)
- SSE protocol: `data: {"type":"text","delta":"…"}` · `{"type":"tool","name":"…"}`
  · `{"type":"done"}` · `{"type":"error","message":"…"}`
- Review item: `{tool, key, note?, added, due:"YYYY-MM-DD", attempts}` under
  localStorage `reviewQueue`; due dates are LOCAL calendar days, minimum tomorrow
- Coach context payload: `{page, title, stats:{today, streak, weak}, take?}`
- File tools: `read_file(path)` roots: student/, curriculum/, reference/;
  `write_file(path, content)` root: student/ only; reject `..`, absolute paths
