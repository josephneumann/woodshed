<div align="center">

<img src="assets/plates/hero-dark-moody.png" alt="A guitar resting on a luthier's workbench, caught in a shaft of amber lamplight" width="820">

# The Woodshed

**A local‑first practice shed for guitarists — with a teacher living inside it.**

*Nineteen hand‑built practice tools on a virtual pedalboard, wired to an AI Instructor
that plans your week, runs your sessions, listens to your playing, and keeps
every promise in plain files on your own machine.*

`local-first` · `files-as-truth` · `your data never leaves the shed`

</div>

---

> *"Woodshedding" — musician's slang for disappearing into the shed until the hard
> thing is played right. This is that shed, rebuilt in espresso and tweed.*

---

## Why this exists

Most practice apps are a metronome with a subscription. The Woodshed starts from a
different premise: **what would it take to feel like you have a real teacher** — one
who remembers everything, plans deliberately, listens to your actual playing, and
never loses the thread between sessions?

Three design laws hold the whole thing together:

1. **Files are the truth.** Your plan, your progress, your gear, your session
   history — every one is a readable JSON or Markdown file in `student/`. The app
   renders them; the Instructor edits them; you can open any of them in a text
   editor and see exactly what your teacher is thinking. No database. No cloud.
2. **Local first, local only.** Everything runs on your machine. The only network
   calls are the ones *you* configure: the Anthropic API for the Instructor's
   brain, and (optionally) xAI for generating artwork. Your practice data is
   gitignored from birth — it cannot leak into a commit.
3. **Evidence over vibes.** The tools record what actually happened — reps,
   accuracy, tempos, timing — and the Instructor cites that record. Never
   *"you're doing great!"*; always *"the gate stalled at 56 BPM Tuesday; we start
   there."*

---

## The tour

### 🎛 The pedalboard

The home page lays all nineteen tools out as a **multi‑row pedalboard** — each family
on its own rail with a strip of masking tape naming it, patch cables sagging between
pedals, and an input jack you can actually plug in (click it — the signal surges down
the chain in amber). Each pedal's LED lights when you've practiced with that tool
today; the Progress amp at the end of the chain glows with your minutes.

| Rail | Pedals |
|---|---|
| **Tune & ear** | Tuner (mic, ±5 cents) · Ear Trainer · Interval Reference · Transcribe |
| **Know the neck** | Scale Trainer · Triad & CAGED · Circle of Fifths · Fretboard Trainer · Chord Lab |
| **Hands, time & voice** | Technique & Drills · Bend & Vibrato Lab · Metronome · Target‑Tone Trainer · Lick Library |
| **Bench & library** | Resource Library · Gear Library · Repertoire · Tone Studio · My Sound |

### 🎓 The Instructor

An embedded AI coach (Anthropic API, streaming, tool‑using) that reads and writes
the same files you do. It is **self‑healing by prime directive**: if what it says
ever diverges from what a file says, it fixes the file in the same breath. It:

- **Runs your intake** — interviews you, writes your profile, builds a combined
  curriculum from whatever courses and materials *you* bring.
- **Plans deliberately** — a weekly briefing with a through‑line, daily plans
  pulled from it, accuracy gates that don't let sloppiness advance the tempo.
- **Drives guided sessions** — one button on the home page (the little tweed amp —
  hover it) ignites a session: a transport strip with per‑step countdowns follows
  you from tool to tool. Pausable, rewindable, one click back to the bench.
- **Remembers everything** — every sitting becomes a durable session record:
  duration, steps done vs. planned, per‑tool numbers, your one‑tap grade, and a
  link to the very conversation you were coached in. Click any day, relive it.
- **Debriefs with evidence** — grades monthly baseline tapes, compares real
  numbers, opens each day with yesterday's record.

### 👂 Tools that listen

The mic tools share a pitch engine (McLeod method, echo‑cancellation off — it's a
guitar, not a conference call) and a site‑wide input picker for your audio interface:

- **Transcribe** — drop in a recording or play live; polyphonic audio → notes,
  chords, tab, MIDI (Spotify's Basic Pitch, entirely on‑device).
- **Bend & Vibrato Lab** — bend to pitch and watch the cents trace; graded peaks,
  vibrato rate and width.
- **Groove report** — the metronome listens back: are you rushing beat 3?
- **Chord Lab** — strum into the mic and it names what you played.
- **Fretboard "Play it" mode** — it asks for an E♭; you answer on the guitar.

### 🎚 Tone Studio & gear

Your *actual* gear, modeled: drag your real pedals onto a virtual board wired the
way yours is wired, dial the knobs on a faithful amp panel, and let the Instructor
chase a target tone with real settings — because it read your `gear.json` and knows
a Tube Screamer from a Fuzz Face. Every piece of gear carries an engraved,
patent‑drawing portrait (generated, in both light and dark finishes).

### 🗺 The degree map

A barre‑chord lattice in the Circle of Fifths that shows where every diatonic chord
*lives* from an anchor barre — same fret across = IV, two up = V, minor pulls the
3rd in a fret — with ghost chips for each chord's second home and a drill that
mixes major and minor until the geometry is yours.

---

## Quick start

You need **Node 20+** and five minutes.

```bash
git clone https://github.com/<you>/woodshed.git
cd woodshed
npm install        # seeds a blank student/ workspace automatically
npm run dev        # → http://localhost:5173
```

That's it for the tools — all nineteen work with no keys and no account.

**To wake the Instructor**, give it a brain:

```bash
cp .env.example .env
# then edit .env:
# ANTHROPIC_API_KEY=sk-ant-...   ← the Instructor (required for coaching)
# XAI_API_KEY=xai-...            ← optional: regenerate artwork with Grok Imagine
```

Restart `npm run dev`, open the coach (the chip in the corner of any page), and say:

> **"Run my intake."**

It will interview you, write your profile, build your curriculum, and put a plan
on the home page. From then on, the tweed amp on the home page is your front door —
one click starts today's session.

### Your first week, honestly

| Day | What happens |
|---|---|
| 1 | Intake conversation → profile, curriculum, first plan |
| 2–6 | Click the amp → guided session → grade it at the chime |
| 7 | Ask for your **weekly briefing** — it reads your real numbers and plans next week |

---

## Your data stays yours

The published repo ships a **blank slate**. On `npm install`, `seed/` is copied
into place for any file that doesn't exist yet — and every one of those paths is
gitignored:

```
student/          your profile, plans, stats, sessions, gear, licks, sound identity
curriculum/       the curriculum the Instructor builds FOR you
reference/…       your course notes and progress extracts
Resources/        your own course PDFs and materials
```

Practice for a year, commit daily, push freely — **none of it can end up in the
repo.** The Instructor's conversations, your recordings, and your uploads are
ignored too. The `.env` with your keys never leaves either.

---

## Under the hood

```
tools/*.html          19 tools — hand-rolled single-file pages, no framework
tools/{theory,audio,stats,pitch,mic,coach,header}.js
                      the shared layer: theory engine, Web-Audio synth (Karplus-
                      Strong pluck), unified practice stats, pitch detection,
                      mic routing, the coach client, the site chrome
server/*-plugin.js    one plugin per feature (coach, sessions, stats, gear, …)
                      each works as BOTH a Vite dev plugin and prod middleware
server/serve.js       the production server — plain node:http, auth-gated,
                      body-capped, path-traversal hardened
student/  (yours)     files-as-truth: everything the app knows about you
seed/                 the blank slate a fresh clone starts from
```

- **Stats sync** is device‑branched: phone and desktop each own a branch in
  `practice-stats.json` and merge on read — no clobbering, no conflicts.
- **Session records** are explicit encounters (start, end, steps, evidence),
  upserted by id — refresh mid‑exercise and your counters resume where you were.
- **The coach's write scope is sandboxed** server‑side: it can touch `student/`
  and nothing else; your API key never reaches the client.
- **PWA**: install it and the tools work offline (the coach needs the wire).

### Practicing from Claude Code instead

The repo doubles as a [Claude Code](https://claude.com/claude-code) workspace: run
`/instructor` in this folder and the same teacher persona drives a lesson from the
terminal, reading and writing the same files. Two front doors, one shed.

### Deploying to a VPS

`DEPLOY.md` covers the whole path: `npm run build`, `node server/serve.js` behind
Caddy, scrypt‑hashed login (`npm run hash-pass`), secure cookies. The same practice
files then sync between your desktop and phone through your own server.

### Regenerating the artwork

Every engraved portrait, masthead motif, and hero plate is generated (xAI Grok
Imagine) by the scripts in `scripts/` — one command each, both finishes. Add a
pedal to your gear, give it a portrait to match.

---

## The look

Espresso and cream, tweed and amber. Fraunces for the display type, patent‑drawing
line art that melts into the page, an amp CTA with a waveform dancing behind the
nameplate and a speaker cab that drops down and thumps when you hover it. Light
mode is a luthier's workbench at noon; dark mode is the same bench at midnight.
**Stage mode** (the lamp in the header) dims everything but what you're reading —
for practicing in a dark room without losing your night eyes.

---

## License

MIT — see [LICENSE](LICENSE). The generated artwork ships with the repo. Course
materials are **not** included — bring your own; the Instructor builds your
curriculum around whatever you're learning from.

<div align="center">

*Now go play the hard thing until it's easy.*

🎸

</div>
