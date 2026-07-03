# PRODUCT-SPEC — The Woodshed, platonic ideal

> Written 2026-07-01. Grounded in a 24-source, adversarially-verified deep-research run
> (8 surviving findings, 1 refuted claim, stats at bottom) + everything already built.
> Companion docs: DESIGN-GOAL.md (identity), BRAND.md (art program), PLAN.md (build log).

## Thesis

**The dream guitar app is a practice-quality coach, not a content library or a streak
machine.** The verified evidence converges hard on this: practice minutes predict
nothing by themselves — achievement flows through *formal practice* (goal-directed,
planned, monitored, evaluated), and the motivation types that streaks/XP/guilt
mechanics feed (introjected + external regulation) predict **neither** practice quality
nor practice time (Bonneville-Roussy & Evans 2024: intrinsic → quality β=.48; guilt/
reward → nothing). Every incumbent optimizes engagement-with-the-app. We optimize
the practice itself, and design motivation that survives the app.

**Who it's for:** the plateaued adult intermediate — plays real songs, stalled for
years, self-taught, practices alone, doesn't need more content; needs a *teacher*.
(Joe is the archetype; the app stays personal-first, local-first.)

## The design laws (each traces to a verified finding)

1. **Scaffold the loop, don't log the minutes.** Every session runs plan → practice →
   evaluate. Goals are co-set with the learner, never imposed. [F1, F5-autonomy]
2. **Feedback is terminal, summoned, and actionable.** Analyze the take *after* it
   ends; the learner presses "show me how I did"; the response leads with ONE fixable
   thing. Never live note-scoring during play (concurrent feedback demonstrably
   impairs retention — the direct critique of Yousician/Rocksmith). Never a bare
   percentage without advice. [F6, F5]
3. **Schedule across sleep.** Accuracy consolidates between sessions only when they
   span sleep (24h apart, not 6h). The engine re-tests yesterday's drill *tomorrow*,
   and treats "grind it again tonight" as an anti-pattern. [F7]
4. **No guilt machinery.** Streaks become a neutral practice-pattern calendar; the
   headline metric becomes "what improved," not "how many days." Quality metrics
   (clean-tempo gains, accuracy-at-tempo, rings earned) replace minutes-logged
   trophies. [F2, F4]
5. **Autonomy-supportive voice.** The Instructor explains *why* every assignment
   exists, offers choices among valid paths, and lets the learner control feedback
   timing. (Teacher autonomy-support drives practice only via internalized
   motivation — full mediation.) [F2, F5]
6. **Cover all three needs — especially relatedness.** Only 25.5% of behavior-change
   apps support autonomy + competence + relatedness; relatedness features are the
   rarest (6–18%). It's the documented gap and our hardest differentiator. [F3]
7. **Design for graduation.** Success = the player who practices well *without* the
   app. Identity-as-musician, real-repertoire payoffs, internalized goals — never
   app-dependent reward loops. [F4]
8. **Record-then-analyze is the feasible frontier.** Basic Pitch gives client-side
   polyphonic transcription with pitch-bend awareness today (<20MB, faster than
   real-time, already integrated). Live streaming polyphonic feedback is FRONTIER —
   don't build the product on it. [F8]

## The feature set

### Pillar 1 — The Instructor, embedded (the spine)
The AI coach (Sonnet via local sidecar; architecture in chat history) present on every
page in three tiers: **dock chip → slide-over drawer → full coach page**. It reads the
live page context + stats spine; conversation follows across pages.
- **Session runner**: co-set today's goal → walk the plan item-by-item → debrief.
  The plan/monitor/evaluate loop as UI, not advice. *(feasible-today; Phase-1 build)*
- **Take debriefs**: after any recorded take, one specific fixable thing + why +
  a drill targeting it, linked pre-configured. *(feasible-today)*
- **Reassessment cadence**: baseline re-runs every 3–4 weeks with A/B take
  comparison — evidence of progress, the plateau antidote. *(exists in workflow;
  automate)*
- **Nudge etiquette**: coach-initiated one-liners only on data thresholds, never
  modal, quiet by default. *(feasible-today)*

### Pillar 2 — The Take system (the feedback organ)
Recording is the center of gravity; everything analyzable flows from takes.
- **Record → analyze → one thing** (law 2) via Basic Pitch: notes, timing spread
  (IOI/CV), bend/vibrato presence, chord-tone landings. *(feasible-today; transcribe
  tool already does the pipeline — add the coaching layer)*
- **Take archive** (IndexedDB): every take stored with context (tool, tempo, guitar);
  side-by-side compare across weeks; "play me from a month ago." *(feasible-today)*
- **Loop + slowdown practice player** on any take. *(built)*
- **Live streaming feedback**: FRONTIER — revisit when in-browser streaming
  polyphonic tracking is proven; do not gate any core loop on it.
- **Stem-separated play-alongs** (Moises-style): feasibility UNVERIFIED (the Demucs
  SDR claim was refuted 0–3) — prototype before promising.

### Pillar 3 — The Scheduler (sleep-aware spaced engine)
- Every drill/lick/position gets a review queue; re-tests scheduled ≥24h out
  (law 3); interleaved sets over massed grinding. *(feasible-today — stats spine
  already has per-key accuracy; add scheduling)*
- "Tomorrow's bench" card on the hub: what's due for consolidation re-test.
- Metronome accuracy-gate feeds it: a tempo passed tonight is only *confirmed*
  when re-passed tomorrow. (Ceremony hooks here — the ring inks on confirmation.)

### Pillar 4 — Instruments, not charts (quality metrics)
- Dashboard = amp-head instrument cluster (VU minutes, accuracy dials, counter
  wheels — DESIGN-GOAL.md layer 2), leading with **what improved this week**.
- Quality metrics: clean-tempo velocity (BPM gained/week), accuracy-at-tempo,
  weak-key closure rate, consolidation hit-rate. Minutes displayed, never headlined.
- Practice-pattern calendar replaces the streak flame (law 4).

### Pillar 5 — Ceremony that doesn't corrupt (rosettes & burns)
- Mastery rosettes ink rings only on *evidence* (confirmed re-tests, recorded
  takes) — never on attendance. Wood-burn stamps for milestones. No XP, no levels,
  no leaderboards. (BRAND.md stamp/plate art program.)

### Pillar 6 — Repertoire as the payoff
- Every technical goal ties to a real piece in REPERTOIRE.md ("this drill exists so
  the Fast Car bridge stops rushing"). Performance takes get archived as the
  trophy shelf: recordings, not badges, are the proof. *(feasible-today)*

### Pillar 7 — Relatedness (the rare one)
- **Share a take** for one listener (a friend, a real teacher) with one question
  attached — not social-feed broadcasting. *(feasible-today; export first, links later)*
- **Monthly recital export**: best takes + progress plates as a shareable page/PDF.
- **The Instructor remembers** — continuity of relationship (names your gear, recalls
  last month's struggle) is itself a relatedness mechanic. *(sidecar memory)*
- Optional later: duet/cohort — one shared goal with one other player. *(frontier-ish
  socially, trivial technically)*

### Pillar 8 — The stack (already true, keep it true)
Local-first, files-as-truth (student/ dir), own-your-data, no accounts, no cloud
dependency except the model API. The coach reads/writes the same files a human
teacher (or Claude Code) would.

## The 8 differentiators (vs everything on the market)

1. A coach in the room on every page — context-aware, relationship-continuous
2. Terminal one-fixable-thing take analysis (vs live note-highways)
3. Sleep-aware consolidation scheduling (nobody schedules re-tests across nights)
4. Learner-summoned feedback + co-set goals (autonomy engineered in)
5. Quality-of-practice metrics headlined; minutes demoted
6. Evidence-inked ceremony (rosettes on confirmed re-tests, recordings as trophies)
7. Relatedness without a social feed (one listener, one question)
8. Motivation designed to survive the app (graduation as success metric)

## What we refuse to build
Live scoring note-highways · guilt streaks/flame · XP/levels/leaderboards ·
content treadmill ("500 new lessons!") · engagement notifications · dark-pattern
paywalls on progress data. The refusals are the brand (see DESIGN-GOAL.md).

## Honest evidence caveats
Verified base covers pedagogy/motivation, app-design gaps, and Basic Pitch
feasibility. Competitor-complaint patterns, plateau anatomy, human-teacher
uniqueness, and AI-tutor transfer did NOT survive verification — those sections
lean on judgment. Strongest studies sample conservatoire students (not adult
hobbyists) and are correlational; motor-learning findings come from lab tasks;
self-controlled-feedback meta-analytics are contested. Where the science is thin
we keep the mechanism cheap to reverse.

## Open questions (to resolve by building)
1. In-browser streaming pitch-tracking latency floor → measure ourselves before
   any live-feedback experiments.
2. Stem-separation quality ceiling → prototype with current Demucs successors.
3. Does SDT-aligned design causally improve retention in music apps? → we are our
   own N=1 experiment; the stats spine is the lab notebook.

## Build order (from here)
1. **Instructor sidecar + drawer** (Pillar 1 core) — the spine everything hangs on
2. **Take archive + debrief loop** (Pillar 2) — transcribe already does the hard part
3. **Scheduler v1** (Pillar 3) — "tomorrow's bench" + confirmation re-tests
4. **Dashboard instrument cluster + quality metrics + calendar** (Pillar 4, art layer)
5. **Rosettes/stamps ceremony** (Pillar 5, assets from BRAND.md program)
6. **Recital export + share-a-take** (Pillars 6–7)

---
*Research stats: 5 angles, 24 sources fetched, 115 claims extracted, 25 verified
(24 confirmed, 1 refuted), 8 findings after synthesis, 106 agent calls.*
