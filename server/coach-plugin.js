// The Instructor — local sidecar for the embedded AI coach.
// A Vite plugin (configureServer) that adds three endpoints to the dev server:
//   POST /api/coach          — stream a coaching turn over SSE (agentic tool loop)
//   GET  /api/coach/health   — {ok, model}
//   GET  /api/coach/history  — the persisted message list (text only) for the drawer
//
// The Anthropic API key comes from .env via loadEnv in vite.config.js and is passed
// in as opts.apiKey — it NEVER reaches client code. The coach reads student/,
// curriculum/, reference/ and writes student/ ONLY, so it can log sessions and keep
// the plan in sync the same way a human teacher (or Claude Code) would.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { resolve, join, relative, isAbsolute, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

const MODEL = 'claude-sonnet-4-6'
// The amp knob in the drawer selects one of these; anything else falls back to MODEL.
const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8']
// Generous ceiling: whole-file rewrites (self-healing plan/gear/repertoire syncs)
// must fit inside ONE tool_use block — 4096 silently truncated ~11KB writes and
// bricked sessions with dangling tool_use blocks (found by the night QA probe).
const MAX_TOKENS = 16000
const MAX_CONTEXT = 40            // send only the last N turns to the API (the file keeps the full transcript)
const READ_ROOTS = ['student', 'curriculum', 'reference']
const WRITE_ROOT = 'student'
// <id> in a session URL/filename: strict, path-safe, and never touches disk unsanitized.
const SESSION_ID_RE = /^[a-z0-9-]{4,24}$/

// Autonomy-supportive persona addendum, appended (uncached) to the system prompt.
// Ordered by priority: voice → the prime directive (self-healing state) → running a
// session → evidence & analysis → files & tools reference → modality extras.
const PERSONA = `

---
1. VOICE & FEEDBACK DISCIPLINE (how you talk in this app):
- Terminal + actionable: after any take or report, lead with ONE fixable thing — the single highest-leverage correction — then the "why", then a concrete next drill. Never a bare percentage without advice. (This "one fixable thing" rule governs every take, report, and grading below — don't restate it, just do it.)
- Autonomy-supportive: explain WHY every assignment exists (tie it to a musical payoff), and offer a choice among valid paths rather than dictating one. Let the learner control feedback timing.
- Never scold about streaks, missed days, or "consistency". Practice quality is the metric, not attendance. If they haven't practiced, find out why and adapt — don't shame.

2. SELF-HEALING STATE (the prime directive for files):
- The student's files ARE what the app renders: current-plan.json is the home page + session-page "Today's plan" checklist, briefing.md is the dashboard's Weekly-briefing card, repertoire.json is the queue. If what you SAY diverges from what a file says, you update the file IN THE SAME TURN. Consistency housekeeping never needs permission — do it, then say one line about what you synced ("updated current-plan.json to match"). Only genuinely destructive or preference-changing edits (deleting items, changing the student's stated goals) get a confirm first.
- NEVER offer the student a multiple-choice question about which file should be right, or ask permission to reconcile — that's your job. When you compose a session that differs from current-plan.json, write the reconciled plan back BEFORE or AS you present it — never present a plan the home page contradicts. When briefing.md and current-plan.json disagree, make the PLAN agree with the BRIEFING (the briefing is the week's through-line; the plan is the day's renderable menu). If they already agree, confirm alignment in one line and don't churn the files.
- When the student answers a standing open question (gear owned, DAW/looper, time available), record it (gear → gear.json; the rest → coach-memory.md via update_memory) and stop re-asking. An open question asked twice is a bug — and once an answer is on file, never re-ask it later in the same session or a future one.
- After meaningful events (a gate passed, a section mastered, a baseline take landed), reflect them in the right file (PROGRESS-LOG.md, repertoire.json section state, progress-data.json) as part of the same conversation, not as homework for later.

3. RUNNING A SESSION (compose it, then DRIVE it — the start_practice_session tool):
- When the student asks to be guided ("practice with me", "run my session", "walk me through today"), don't just describe a plan — CALL start_practice_session with 3-5 steps totalling ~20 min. The app renders a floating strip with a per-step countdown, an "Open tool" link, and next/skip/end controls; it auto-advances and chimes at each step's end. Reconcile current-plan.json with the briefing FIRST (per §2), then build the steps from that reconciled plan — not a generic warmup. Lead with the weakest domain; pull due reviews (context.stats.due) and the current repertoire section (repertoire.json items[0]). Each step's "tool" is a page filename (e.g. 'ear-trainer.html', 'metronome.html', 'transcribe.html') or 'chat' for a coaching-only step.
- If the student is on the session page (context.page ≈ 'session'), the plan checklist is visible on their screen beside you. Reference steps by the item NAME as it appears on the checklist so they can follow along; don't re-list the whole plan in prose after calling the tool — the strip shows it. Keep coaching in chat as they work; the strip runs client-side, so you stay available to answer, adjust, and debrief.
- A message that OPENS with "Practice with me — reconcile" is the app's Start button (the amp on the home page / the session page's start control), not something the student typed. If it arrives while a guided session from THIS conversation is already underway, do NOT build a fresh strip or re-plan — say you're already mid-session and pick up exactly where the current step left off. Never speculate to the student about UI wiring or tell them to refresh the page; if the app double-fires, that's the app's bug to absorb silently.
- SESSION RECORDS ARE THE APP'S JOB: when a guided session ends, the app writes the session record itself (to student/sessions.json) — do NOT write one; your job at session end is the debrief (compare done-vs-planned, cite the numbers, set up tomorrow). When the student starts a new day, read the latest session record first and OPEN with it ("Yesterday: 24 min, 4/5 steps, ear 8/10 — the gate stalled at 56; we start there").

4. EVIDENCE & ANALYSIS (takes, stats, briefings, grading — never guess, cite):
- practice-stats.json is FILE-READABLE EVIDENCE. read_file student/practice-stats.json when you need real reps/tempos/accuracy behind a claim; it is the shared, device-synced truth. It is read-only to you — stats are evidence, never fabricated. (context.stats carries a live digest; the file carries the full history — merge branches per AGENT-INTERFACE if you read totals.)
- student/sessions.json is the SESSION LOG — one record per sitting (duration, steps completed, per-tool numbers, grade+note, coachSessionId linking to the debrief conversation). When discussing history ("how did Tuesday go", "am I improving"), cite THIS file — sessions are the narrative; practice-stats.json is the raw exhaust behind it. read_file it; it is written by the app (read-only to you EXCEPT: you may amend a record's grade/note fields via write_file when the student grades a session in chat).
- RECORDINGS (drawer mic) & TAKE DATA (context.take from tools/transcribe.html): a take gives you context.take = {source, durationSec, bpmGuess?, noteCount, notes:[{t (onset sec), midi, name, durSec}] (first 400), report}. This is a Basic-Pitch transcription — PITCH and TIMING only, NOT tone, dynamics, articulation, or string/finger. Be honest about that limit; never critique tone or feel from it. The raw audio is saved under student/recordings/ for the student's own A/B listening — reference it by path, don't pretend to have heard it.
- Genuinely analyse the numbers — don't hand-wave. Read the notes array: NOTE CHOICES (pitch classes vs. the key/chord of the section — wrong/out-of-scale notes? missing chord tones?); TIMING GAPS (large jumps in t = hesitations; the onset-steadiness CV in the report, higher = less even); REPEATED STUMBLES (clusters of the same midi restruck within a fraction of a second usually mean a restart/flub — call out WHICH second); RANGE (min/max midi — is it sitting where the section lives?); TEMPO (compare bpmGuess to the section target; use the IOI/CV numbers for steadiness). Cross-reference repertoire.json items[0].sections and the current curriculum block first, so your read is about THIS piece at THIS level. Then give the one prioritized fix. If the data is too thin, say so and ask what they played rather than inventing a fault.
- WEEKLY BRIEFING (student/briefing.md — YOUR one-page lesson plan; the dashboard renders it). When asked for a briefing: read PROGRESS-LOG.md (tail = newest on top), repertoire.json (section = items[0]), and context.stats; then write_file student/briefing.md, under ~40 lines: a "# Weekly Briefing — <date>" title; "## This week's focus" (1-2 sentences); "## Prescriptions" (3-5 items, each a tool-PAGE markdown link with a dose and one-line why); "## Stretch" (one optional reach); "## Why" (one line citing last week's actual numbers). Lead with the weakest domain, tie every item to the current section + block, don't pad. Then give the one-line version in chat.
- GRADING TAPE (student/grading-log.md — the monthly assessment). Monthly, or on "grade my tape"/"run my assessment": (1) read grading-log.md (create if missing, newest on top) and BASELINE.md so you know the 4 exercises and last month's readings; (2) collect this month's takes one by one, analysing each as above; (3) write a dated grading-log.md entry — per-exercise readings (tempo steadiness, error clusters, range), a one-line verdict vs last month, and 1-2 sentences of trajectory; (4) THEN update the six domain numbers in progress-data.json — ONLY with evidence you can cite, never more than ±1/month; say what moved and why. Grade what you got if takes are missing; never invent a reading. If it's under 3 weeks since the last entry, say so and offer to wait.

5. FILES & TOOLS — the repertoire queue, and prescribing tools by name:
- REPERTOIRE QUEUE (student/repertoire.json): the song library AND the learning queue. "items" array, ARRAY ORDER = PRIORITY (index 0 = current focus). Each item: {id, title, artist, url, source, status (learning|queued|paused|performing|retired), sections, why, notes, added}. read_file before you reason about what's next or reorder; write the whole file back to change order, status, or notes. To research songs: web_search first, propose 2-3 candidates with a one-line WHY each (tied to their block/level — read PROFILE + current-plan first), add nothing until they confirm; on yes, append with status "queued" (or "learning" if it's the new focus) and preserve existing order.
- PRESCRIBE TOOLS BY NAME when the data points at one — don't send them to a generic "the app". The workspace has: Metronome (metronome.html — has a groove/timing report that flags rushing vs. dragging), Bend Lab (bend-lab.html — bend-pitch accuracy), Chord Lab (chord-lab.html — voicings/grips), Tuner (tuner.html), Lick Library (licks.html — vocabulary drills), Ear Trainer (ear-trainer.html), Scale Trainer, Fretboard Trainer, Triad Trainer, Circle of Fifths, Transcribe, Target-Tone Trainer, Tone Studio, My Sound (identity.html), Recital. Route by symptom: rushing/uneven time → the Metronome groove report; bends landing flat/sharp → Bend Lab; thin vocabulary / box-running → Lick Library drills; shaky voicings → Chord Lab; weak intervals/chord-quality ear → Ear Trainer.
- BROWSER-BRIDGE tools apply in the OPEN page (set_pref, schedule_review, complete_review): tell the student what you changed. schedule_review enqueues a next-day consolidation re-test (sleep rule) — use it when you assign something worth confirming after sleep.
- WEB & RESOURCE LIBRARY: web_search when the student wants lessons/videos/backing tracks/gear info or when currency matters — pick 2-3, say WHY each fits their current block/level, prefer teachers already in their orbit (Paul Davids, JustinGuitar, Andrew Clarke) when quality is equal. When they like a find, offer to save it; on their yes, add_resource. Don't add without asking.
- PAST CONVERSATIONS (student/coach-sessions/): every conversation is its own JSON file ({id, title, created, updated, messages}); this is the live one. When the student references an earlier discussion, list_files "student/coach-sessions" and read_file the one whose title/updated matches. Never write those files — the app owns them.

6. MODALITY EXTRAS (photos, sound identity, tone):
- PHOTOS (vision): when a photo arrives you SEE it in THAT turn only — in every later turn it appears as a text marker "[photo attached: student/uploads/…jpg]", so read what you need NOW and note anything you'll want later. (a) GEAR INTAKE — identify each piece you can (make/model, finish, pickup type, features), read gear.json, report what's already inventoried vs. new; add new items ONLY after the student confirms, appending in the file's existing shape. (b) RIG READING — state each knob as a clock position AND rough 0-10 value with your uncertainty ("gain looks ~1 o'clock ≈ 6, but the angle's steep — correct me"), give ALL readings, flag what's unsure, ask them to correct you; only AFTER they confirm, build a tone-presets.json preset (read first, append the documented shape, write back). Never invent a reading you can't see (glare, angle, hidden knobs).
- SOUND IDENTITY (student/sound-identity.json): the answer to "what sound am I chasing?" — {statement (first-person target-tone sentence in THEIR voice), tonewords, axes ({name,left,right,value 0-10}), influences ({id,artist,why,songs,tags,added})}. My Sound (identity.html) edits it via /api/identity; context.identity is the current page state (reason from it, but read the file before you WRITE). To articulate a sound: interview ONE question at a time (4-5), mining repertoire.json + resource-library.json + past sessions for who they already orbit; draft the statement in first person, write only after they approve. To suggest influences: propose ~3 with a one-line WHY, ASK first; on yes, append to influences and write the whole file back. Never inflate. Nudge the tie-ins: chase an influence's tone in Tone Studio, queue their song into the repertoire queue.
- TONE (student/tone-presets.json + tone-studio.html): Tone Studio turns the student's REAL gear (gear.json) into a virtual rig. context.tone is the current board: {guitarId, pickup, volume, tone, chain:[{gearId,settings}], amp:{volume,fat,treble,bass,middle,master,reverb}} — the amp keys mirror their real Blues Jr IV panel left→right (fat is a boolean switch; legacy {gain,mid} auto-migrates on load; signal enters bottom-right, exits top-left). To chase a tone (song/artist/link): web_search the documented rig, then TRANSLATE onto their actual gear — name the guitar/pickup, the pedal order from pedals they own, exact 0-10 knob values; be honest about gaps and offer the nearest substitute. You can't hear audio — you research documented rigs, covers, and settings guides; say so if asked. Save a preset ONLY after they confirm (read tone-presets.json, append {id, name, desc, guitarId, pickup, volume, tone, chain, amp, notes, createdBy:"coach", added:<local date>}, write back, tell them to refresh the presets panel).`

// ---------- path safety ----------
// Resolve a client-supplied path inside one of the allowed roots. Rejects absolute
// paths and any '..' escape by canonicalizing and confirming containment.
function safePath(root, rootDirAbs, p) {
  if (typeof p !== 'string' || !p.length) throw new Error('path required')
  // strip a leading root prefix if the model included it (e.g. "student/PROFILE.md")
  let rel = p.replace(/^[.\/\\]+/, '')
  if (rel === root || rel.startsWith(root + '/') || rel.startsWith(root + '\\')) rel = rel.slice(root.length + 1)
  if (isAbsolute(rel)) throw new Error('absolute paths not allowed')
  const abs = resolve(rootDirAbs, rel)
  const relBack = relative(rootDirAbs, abs)
  if (relBack.startsWith('..') || isAbsolute(relBack)) throw new Error('path escapes root: ' + p)
  return abs
}

// ---------- tool definitions ----------
// web_search is an Anthropic SERVER tool: searches run on Anthropic's side and the
// results stream back as content blocks — no execution needed here. max_uses caps
// cost per turn. Requires pause_turn handling in the loop (see handleCoach).
const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file. Allowed roots: student/, curriculum/, reference/. Pass a path relative to the repo root, e.g. "student/PROFILE.md" or "reference/glossary.md".',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path under student/, curriculum/, or reference/.' } },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory under student/, curriculum/, or reference/. Pass a dir like "student" or "student/practice-plans".',
    input_schema: {
      type: 'object',
      properties: { dir: { type: 'string', description: 'Directory under one of the allowed roots.' } },
      required: ['dir'],
    },
  },
  {
    name: 'write_file',
    description: 'Write (create or overwrite) a UTF-8 text file under student/ ONLY. Use to log sessions to student/PROGRESS-LOG.md, update student/current-plan.json, etc. Read the file first if you mean to append rather than replace.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path under student/ only.' },
        content: { type: 'string', description: 'Full file contents to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'update_memory',
    description: 'Update your own durable teaching memory (student/coach-memory.md) — observations about this student that should survive across conversations: recurring struggles, what motivates them, promises made, preferences. mode "append" adds a dated line; "replace" rewrites the whole file (read it first).',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        mode: { type: 'string', description: '"append" (default) or "replace"' },
      },
      required: ['content'],
    },
  },
  {
    name: 'set_pref',
    description: 'Set a tool preference in the practice app (applied live in the browser via Stats.setPref). Example: set the metronome default BPM, or a trainer difficulty. Use sparingly and tell the student what you changed.',
    input_schema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Tool id, e.g. "metronome", "ear-trainer".' },
        key: { type: 'string' },
        value: { description: 'Any JSON value.' },
      },
      required: ['tool', 'key', 'value'],
    },
  },
  {
    name: 'schedule_review',
    description: 'Enqueue a next-day consolidation re-test in the practice app review queue (Stats.review.add — due tomorrow, per the sleep-consolidation rule). Use when you assign something that should be confirmed after sleep.',
    input_schema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Owning tool id, e.g. "metronome", "scale-trainer".' },
        key: { type: 'string', description: 'Item key, e.g. "tempo:104" or "minPent:9:0".' },
        note: { type: 'string', description: 'Human-readable line shown on the Tomorrow\'s bench card.' },
      },
      required: ['tool', 'key'],
    },
  },
  {
    name: 'complete_review',
    description: 'Mark a due review item confirmed (pass=true) or failed/re-queued for tomorrow (pass=false) in the practice app (Stats.review.complete).',
    input_schema: {
      type: 'object',
      properties: {
        tool: { type: 'string' },
        key: { type: 'string' },
        pass: { type: 'boolean' },
      },
      required: ['tool', 'key', 'pass'],
    },
  },
  {
    name: 'start_practice_session',
    description: 'Launch a GUIDED practice session in the app ("Practice with me"). Emits a floating session strip in the browser that walks the student through 3-5 timed steps totalling ~20 minutes, one tool page per step, with a countdown and auto-advance. Compose the steps from the current curriculum block, due reviews, and the repertoire section, then keep coaching in chat as they go.',
    input_schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: '3-5 ordered steps, ~20 min total.',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: "Page filename to open for this step, e.g. 'metronome.html', 'ear-trainer.html', 'transcribe.html' — or 'chat' for a coaching-only step (no page)." },
              title: { type: 'string', description: 'Short step title, e.g. "Interval ear reps".' },
              minutes: { type: 'number', description: 'Length of this step in minutes.' },
              note: { type: 'string', description: 'One line on what to do this step.' },
            },
            required: ['tool', 'title', 'minutes'],
          },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'add_resource',
    description: 'Add one resource (YouTube video/channel, course, article, backing track…) to the Resource Library (reference/resource-library.json) after the student agrees to save it. Dedupes by URL.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        url: { type: 'string' },
        category: { type: 'string', description: 'One of: Courses & Platforms, YouTube Channels, Theory & Harmony, Fretboard, Ear Training, Transcription, Rhythm & Time, Repertoire & Songs, Tabs & Backing Tracks, Other.' },
        type: { type: 'string', description: 'One of: course, platform, youtube-channel, youtube-video, tool, article, tabs, backing-track, other.' },
        note: { type: 'string', description: 'One line on why it fits this student right now.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'url', 'category', 'type'],
    },
  },
]

// Internal factory: wires the API client, tool loop, history, and upload handlers,
// and returns { name, handler }. The Vite plugin and the named middleware both use it.
function coachBuild(opts) {
  opts = opts || {}
  const apiKey = opts.apiKey || ''
  const root = opts.root || process.cwd()

  const rootAbs = {}
  for (const r of READ_ROOTS) rootAbs[r] = resolve(root, r)

  const client = apiKey ? new Anthropic({ apiKey }) : null

  // Cache the system prompt string in memory; re-read SYSTEM-PROMPT.md lazily.
  let systemCache = null
  function buildSystemBlocks() {
    if (!systemCache) {
      let prompt = ''
      try { prompt = readFileSync(resolve(root, 'SYSTEM-PROMPT.md'), 'utf8') } catch (e) { prompt = 'You are The Instructor, a rigorous guitar teacher.' }
      // workspace map: list student/ files with a one-line note
      let map = '\n\n## Workspace map (files you can read/write)\n'
      map += 'You read student/, curriculum/, reference/ and write student/ ONLY.\n\n'
      try {
        const sdir = resolve(root, 'student')
        const files = readdirSync(sdir)
        const notes = {
          'PROFILE.md': 'the Student Profile (history, goals, gear, self-ratings)',
          'PROGRESS-LOG.md': 'the running session log — newest on top; append here',
          'BASELINE.md': 'baseline assessment / ground truth',
          'REPERTOIRE.md': 'pieces being learned to performance standard',
          'current-plan.json': 'the active practice plan (structured; the hub renders it)',
          'progress-data.json': 'structured mirror of the log for the dashboard',
          'briefing.md': 'YOUR weekly briefing — the one-page plan you write & keep current (the dashboard renders it)',
          'gear.json': 'guitar/amp/pedal inventory + current guitar',
          'coach-history.json': 'this conversation history (managed by the app)',
          'practice-plans': 'directory of dated practice-plan files',
        }
        for (const f of files) {
          const note = notes[f] || (isDir(join(sdir, f)) ? 'directory' : 'file')
          map += `- student/${f} — ${note}\n`
        }
      } catch (e) { /* leave map as-is */ }
      map += '\ncurriculum/ holds MASTER-CURRICULUM.md and SYLLABUS.md; reference/ holds Paul Davids / JustinGuitar / Andrew Clarke extracts, a glossary, and resource-library.json.'
      systemCache = prompt + map
    }
    // coach memory is small and changes often — read fresh, keep it OUT of the
    // cached block so memory updates never invalidate the big cached prefix
    let memory = ''
    try { memory = readFileSync(resolve(root, 'student', 'coach-memory.md'), 'utf8') } catch (e) { /* none yet */ }
    return [
      // stable, cached prefix: SYSTEM-PROMPT.md + workspace map
      { type: 'text', text: systemCache, cache_control: { type: 'ephemeral' } },
      // persona addendum + memory + volatile note (uncached)
      { type: 'text', text: PERSONA + (memory ? '\n\n---\nYOUR MEMORY (student/coach-memory.md — update via update_memory):\n' + memory : '') + '\n\nLive context arrives with each user message as JSON.' },
    ]
  }

  function isDir(p) { try { return statSync(p).isDirectory() } catch (e) { return false } }

  // ---------- session store ----------
  // One JSON file per session at student/coach-sessions/<id>.json:
  //   { id, title, created, updated, messages:[...] }
  // messages are full API-shape turns (content arrays with tool_use etc.); each stored
  // message additionally carries a ts (epoch ms). The FILE keeps the whole transcript —
  // only the last MAX_CONTEXT turns are sent to the API (see handleCoach). The legacy
  // coach-history.json / coach-archive.json files are superseded; on first use we migrate
  // any existing history into a session and rename it out of the way.
  const sessionsDir = resolve(root, 'student', 'coach-sessions')
  const legacyHistoryFile = resolve(root, 'student', 'coach-history.json')

  // reject anything that isn't a strict, path-safe id BEFORE it touches the filesystem
  function validId(id) { return typeof id === 'string' && SESSION_ID_RE.test(id) }
  function sessionPath(id) {
    if (!validId(id)) throw new Error('bad session id')
    return join(sessionsDir, id + '.json')
  }
  function makeId() {
    // 8-12 lowercase-hex chars from crypto; comfortably inside [a-z0-9-]{4,24}
    return randomBytes(6).toString('hex') // 12 chars
  }

  function loadSession(id) {
    try {
      const d = JSON.parse(readFileSync(sessionPath(id), 'utf8'))
      if (!d || typeof d !== 'object') return null
      d.messages = Array.isArray(d.messages) ? d.messages : []
      return d
    } catch (e) { return null }
  }
  function saveSession(sess) {
    try {
      mkdirSync(sessionsDir, { recursive: true })
      sess.updated = new Date().toISOString()
      // Atomic write: tmp + rename so a crash (or two concurrent same-session saves)
      // never leaves a half-written file that then fails JSON.parse and loses the
      // whole session. The tmp name carries a random suffix so two in-flight saves
      // to the same id don't clobber each other's tmp (rename is last-writer-wins,
      // which is the accepted concurrency semantics here — but each file is whole).
      const dest = sessionPath(sess.id)
      const tmp = dest + '.' + randomBytes(4).toString('hex') + '.tmp'
      writeFileSync(tmp, JSON.stringify(sess, null, 2))
      renameSync(tmp, dest)
    } catch (e) { /* non-fatal */ }
    return sess
  }
  // A user message's first ~44 chars → a title: cut at a word boundary, no trailing punctuation.
  function titleFrom(text) {
    let t = String(text || '').replace(/\s+/g, ' ').trim()
    if (!t) return 'New session'
    if (t.length > 44) {
      t = t.slice(0, 44)
      const sp = t.lastIndexOf(' ')
      if (sp > 20) t = t.slice(0, sp)
    }
    return t.replace(/[\s.,;:!?—–-]+$/, '').trim() || 'New session'
  }
  function createSession(title) {
    // avoid the vanishingly-rare id collision
    let id = makeId()
    while (existsSync(join(sessionsDir, id + '.json'))) id = makeId()
    const now = new Date().toISOString()
    const sess = { id, title: title || 'New session', created: now, updated: now, messages: [] }
    return saveSession(sess)
  }
  function deleteSession(id) {
    try { unlinkSync(sessionPath(id)); return true } catch (e) { return false }
  }
  function listSessionFiles() {
    try { return readdirSync(sessionsDir).filter(f => /^[a-z0-9-]{4,24}\.json$/.test(f)) }
    catch (e) { return [] }
  }

  // Text of a stored message (user string with the live-context block stripped, or the
  // concatenated text blocks of an assistant/array turn). Empty for tool-only turns.
  function messageText(m) {
    if (typeof m.content === 'string') {
      let text = m.content
      const idx = text.indexOf('\n\nLIVE CONTEXT (JSON): ')
      if (idx >= 0) text = text.slice(0, idx)
      return text
    }
    if (Array.isArray(m.content)) return m.content.filter(b => b.type === 'text').map(b => b.text).join('')
    return ''
  }

  // One-time migration: if the legacy coach-history.json still exists and no session
  // files are present yet, fold it into a session (title from its first user message)
  // and rename the legacy file so we never migrate twice.
  let migrated = false
  function migrateLegacyOnce() {
    if (migrated) return
    migrated = true
    try {
      if (!existsSync(legacyHistoryFile)) return
      if (listSessionFiles().length) return
      let d
      try { d = JSON.parse(readFileSync(legacyHistoryFile, 'utf8')) } catch (e) { return }
      const msgs = (d && Array.isArray(d.messages)) ? d.messages : []
      const firstUser = msgs.find(m => m.role === 'user')
      const sess = createSession(firstUser ? titleFrom(messageText(firstUser)) : 'Earlier conversation')
      sess.messages = msgs   // ts absent is ok per contract
      if (d && d.updated) sess.created = d.updated
      saveSession(sess)
      try { renameSync(legacyHistoryFile, resolve(root, 'student', 'coach-history.migrated.json')) } catch (e) { /* non-fatal */ }
    } catch (e) { /* migration is best-effort */ }
  }

  // Render a session's messages as text-only client turns (drop empty/tool-only turns).
  function sessionForClient(sess) {
    return (sess.messages || []).map(m => ({ role: m.role, text: messageText(m), ts: m.ts }))
      .filter(m => m.text && m.text.trim().length)
      .map(m => (m.ts == null ? { role: m.role, text: m.text } : m))
  }
  // The summary object for the sessions list (preview = first ~70 chars of the last text turn).
  function sessionSummary(sess) {
    const turns = (sess.messages || []).map(messageText).filter(t => t && t.trim().length)
    const last = turns.length ? turns[turns.length - 1].replace(/\s+/g, ' ').trim() : ''
    return {
      id: sess.id,
      title: sess.title || 'New session',
      created: sess.created,
      updated: sess.updated,
      count: turns.length,
      preview: last.length > 70 ? last.slice(0, 70) : last,
    }
  }
  function listSessions() {
    migrateLegacyOnce()
    const out = []
    for (const f of listSessionFiles()) {
      const sess = loadSession(f.replace(/\.json$/, ''))
      if (sess) out.push(sessionSummary(sess))
    }
    out.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
    return out
  }
  // The most-recently-updated session (for the legacy /history route).
  function latestSession() {
    migrateLegacyOnce()
    let best = null
    for (const f of listSessionFiles()) {
      const sess = loadSession(f.replace(/\.json$/, ''))
      if (!sess) continue
      if (!best || String(sess.updated || '') > String(best.updated || '')) best = sess
    }
    return best
  }

  // ---------- tool execution ----------
  // `emit` sends an SSE event to the live drawer; client-bridge tools use it to
  // apply changes to browser-owned data (localStorage via Stats) — see AGENT-INTERFACE.md.
  function runTool(name, input, emit) {
    input = input || {}
    if (name === 'update_memory') {
      const memPath = resolve(root, 'student', 'coach-memory.md')
      const mode = input.mode === 'replace' ? 'replace' : 'append'
      let cur = ''
      try { cur = readFileSync(memPath, 'utf8') } catch (e) { cur = '# Coach memory — durable notes about this student\n' }
      const d = new Date(), pp = (n) => String(n).padStart(2, '0')
      const stamp = d.getFullYear() + '-' + pp(d.getMonth() + 1) + '-' + pp(d.getDate())
      const next = mode === 'replace' ? String(input.content) : cur.replace(/\s*$/, '\n') + '- (' + stamp + ') ' + String(input.content).trim() + '\n'
      writeFileSync(memPath, next)
      return (mode === 'replace' ? 'Rewrote' : 'Appended to') + ' coach memory.'
    }
    if (name === 'set_pref') {
      emit && emit({ type: 'client', action: 'setPref', tool: String(input.tool), key: String(input.key), value: input.value })
      return 'Preference sent to the app: ' + input.tool + '.' + input.key + ' = ' + JSON.stringify(input.value) + ' (applies in the open page).'
    }
    if (name === 'schedule_review') {
      emit && emit({ type: 'client', action: 'scheduleReview', tool: String(input.tool), key: String(input.key), note: String(input.note || '') })
      return 'Review queued in the app for tomorrow: ' + input.tool + ' / ' + input.key + '.'
    }
    if (name === 'complete_review') {
      emit && emit({ type: 'client', action: 'completeReview', tool: String(input.tool), key: String(input.key), pass: !!input.pass })
      return 'Review ' + (input.pass ? 'confirmed' : 're-queued for tomorrow') + ': ' + input.tool + ' / ' + input.key + '.'
    }
    if (name === 'start_practice_session') {
      // sanitize the steps into a clean array before it reaches the browser strip
      const raw = Array.isArray(input.steps) ? input.steps : []
      const steps = raw.slice(0, 5).map((s) => ({
        tool: String((s && s.tool) || 'chat'),
        title: String((s && s.title) || 'Practice'),
        minutes: Math.max(1, Math.min(60, Math.round(Number(s && s.minutes) || 5))),
        note: String((s && s.note) || ''),
      }))
      if (!steps.length) throw new Error('at least one step is required')
      emit && emit({ type: 'client', action: 'practice_session', steps })
      const total = steps.reduce((a, s) => a + s.minutes, 0)
      return 'Started a guided session in the app: ' + steps.length + ' steps, ~' + total + ' min (' + steps.map(s => s.title + ' ' + s.minutes + 'm').join(', ') + '). The session strip is now running in the browser.'
    }
    if (name === 'read_file') {
      const abs = pickReadPath(input.path)
      return readFileSync(abs, 'utf8')
    }
    if (name === 'list_files') {
      const abs = pickReadPath(input.dir, true)
      const entries = readdirSync(abs).map(f => isDir(join(abs, f)) ? f + '/' : f)
      return entries.join('\n') || '(empty)'
    }
    if (name === 'write_file') {
      const abs = safePath(WRITE_ROOT, rootAbs[WRITE_ROOT], input.path)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, String(input.content == null ? '' : input.content))
      return 'Wrote ' + relative(root, abs).replace(/\\/g, '/') + ' (' + String(input.content || '').length + ' chars).'
    }
    if (name === 'add_resource') {
      // Deliberate, narrowly-scoped exception to the student/-only write rule:
      // the coach may append to the Resource Library seed file (and nothing else
      // under reference/). Dedupes by URL; marks the entry as coach-added.
      if (!input.title || !input.url) throw new Error('title and url required')
      const libPath = resolve(root, 'reference', 'resource-library.json')
      const lib = JSON.parse(readFileSync(libPath, 'utf8'))
      lib.resources = lib.resources || []
      const url = String(input.url).trim()
      if (lib.resources.some(r => (r.url || '').replace(/\/+$/, '') === url.replace(/\/+$/, '')))
        return 'Already in the library: ' + url
      lib.resources.push({
        id: 'coach-' + Date.now().toString(36),
        title: String(input.title),
        url,
        category: String(input.category || 'Other'),
        type: String(input.type || 'other'),
        source: 'The Instructor',
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        note: String(input.note || ''),
      })
      lib.updated = new Date().toISOString().slice(0, 10)
      writeFileSync(libPath, JSON.stringify(lib, null, 2))
      return 'Added to the Resource Library: ' + input.title + ' (' + url + '). It will appear in resource-library.html on reload.'
    }
    throw new Error('unknown tool: ' + name)
  }
  // Resolve a read path by trying each allowed root (the model may or may not prefix it).
  function pickReadPath(p, allowDir) {
    if (typeof p !== 'string' || !p.length) throw new Error('path required')
    const cleaned = p.replace(/^[.\/\\]+/, '')
    const first = cleaned.split(/[\/\\]/)[0]
    if (READ_ROOTS.includes(first)) return safePath(first, rootAbs[first], cleaned)
    // no root prefix — default to student/ for files, but allow bare root dir names for listing
    if (allowDir && READ_ROOTS.includes(cleaned)) return rootAbs[cleaned]
    return safePath(WRITE_ROOT, rootAbs[WRITE_ROOT], cleaned)
  }

  // ---------- SSE helpers ----------
  function sse(res, obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n') }

  // ---------- the streaming tool loop ----------
  async function handleCoach(req, res, body) {
    if (!client) { sse(res, { type: 'error', message: 'ANTHROPIC_API_KEY not set in .env — the coach is offline.' }); sse(res, { type: 'done' }); res.end(); return }

    // resolve the target session: valid sessionId → that file; else create a fresh one
    // and announce it as the FIRST SSE event so the client can adopt the id.
    migrateLegacyOnce()
    let sess = null
    if (validId(body.sessionId)) sess = loadSession(body.sessionId)
    if (!sess) {
      sess = createSession('New session')
      sse(res, { type: 'session', id: sess.id, title: sess.title })
    }

    // reset:true clears the given session's messages (legacy path; the client no longer uses it)
    if (body.reset) { sess.messages = []; saveSession(sess) }

    const userText = String(body.message || '').trim()

    // ---- optional photo (vision) ----
    // body.image = { media_type, data (base64, no data: prefix) }. Validated, size-capped,
    // and saved to student/uploads/. The LIVE turn gets the real image; the SAVED transcript
    // stores a text marker so base64 never lands on disk and the resend window stays cheap.
    let imageBlock = null      // the real image block for THIS turn's API call
    let imageMarker = ''       // '[photo attached: <path>]' persisted in place of the image
    if (body.image && typeof body.image === 'object') {
      const savedImg = acceptImage(body.image)
      if (savedImg && savedImg.error) { sse(res, { type: 'error', message: savedImg.error }); sse(res, { type: 'done' }); res.end(); return }
      if (savedImg) {
        imageBlock = { type: 'image', source: { type: 'base64', media_type: savedImg.media_type, data: savedImg.data } }
        imageMarker = '[photo attached: ' + savedImg.path + ']'
      }
    }

    if (!userText && !imageBlock) { sse(res, { type: 'error', message: 'Empty message.' }); sse(res, { type: 'done' }); res.end(); return }

    // AUTO-TITLE: a still-untitled session takes its title from the first user message.
    // Emit the updated title so the client relabels it (a brand-new session already got a
    // 'session' event above with the placeholder title — this second one carries the real one).
    if ((sess.title || 'New session') === 'New session' && !sess.messages.some(m => m.role === 'user')) {
      sess.title = titleFrom(userText)
      sse(res, { type: 'session', id: sess.id, title: sess.title })
    }

    // The user turn carries the visible message + a live-context JSON block.
    const ctx = body.context || {}
    // stamp the local date so log entries and plans never guess it
    const now = new Date()
    const p = (n) => String(n).padStart(2, '0')
    ctx.localDate = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate())
    const contextNote = 'LIVE CONTEXT (JSON): ' + JSON.stringify(ctx)
    const turnText = userText + '\n\n' + contextNote
    // The PERSISTED user turn never holds base64. With a photo, it stores a string whose
    // text block carries the '[photo attached: …]' marker; the real image is substituted
    // only into THIS turn's live API call (see liveMessages below).
    let persistedContent
    if (imageBlock) {
      // marker precedes the text so a re-read transcript still reads naturally
      persistedContent = imageMarker + '\n\n' + turnText
    } else {
      persistedContent = turnText
    }
    const userTurnIndex = sess.messages.length
    sess.messages.push({ role: 'user', content: persistedContent, ts: Date.now() })

    const system = buildSystemBlocks()
    const model = ALLOWED_MODELS.includes(body.model) ? body.model : MODEL
    // If the browser hangs up mid-turn, stop the agentic loop so we don't keep
    // burning API tokens (and holding the loop open) for a client that's gone.
    let clientGone = false
    const onClose = () => { clientGone = true }
    res.on('close', onClose)
    let guard = 0
    try {
      while (guard++ < 12) {
        if (clientGone) break
        let assistantBlocks = []
        let stopReason = null

        // the FILE keeps the full transcript; only the last MAX_CONTEXT turns go to the API.
        // strip the local-only `ts` so the API sees clean {role, content} turns.
        const liveMessages = sess.messages.slice(-MAX_CONTEXT).map(({ role, content }) => ({ role, content }))
        // substitute the REAL image into this turn's user content for the live API call ONLY
        // (only on the first loop iteration — later iterations carry tool results after it).
        if (imageBlock && guard === 1) {
          const offset = Math.max(0, sess.messages.length - MAX_CONTEXT)
          const liveIdx = userTurnIndex - offset
          if (liveIdx >= 0 && liveIdx < liveMessages.length) {
            liveMessages[liveIdx] = { role: 'user', content: [imageBlock, { type: 'text', text: turnText }] }
          }
        }

        const stream = client.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system,
          tools: TOOLS,
          messages: liveMessages,
        })
        stream.on('text', (delta) => { sse(res, { type: 'text', delta }) })
        // surface server-tool activity (web search runs on Anthropic's side) so the
        // drawer can show "web_search…" while results stream in
        stream.on('streamEvent', (ev) => {
          if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'server_tool_use')
            sse(res, { type: 'tool', name: ev.content_block.name })
        })

        const msg = await stream.finalMessage()
        assistantBlocks = msg.content
        stopReason = msg.stop_reason
        // record the assistant turn (full content, so tool_use blocks round-trip)
        sess.messages.push({ role: 'assistant', content: assistantBlocks, ts: Date.now() })

        // server-tool loop hit its iteration cap mid-search — re-send as-is to resume
        if (stopReason === 'pause_turn') continue
        // output ceiling hit MID-TOOL-CALL: the tool_use content is truncated and was
        // never executed. Answer each dangling call with an error result and CONTINUE,
        // so the model retries (smaller / split) instead of narrating a phantom success
        // — and the transcript never carries a tool_use without its tool_result.
        if (stopReason === 'max_tokens' && assistantBlocks.some((b) => b.type === 'tool_use')) {
          const truncated = assistantBlocks.filter((b) => b.type === 'tool_use').map((b) => ({
            type: 'tool_result', tool_use_id: b.id, is_error: true,
            content: 'TRUNCATED: this tool call hit the output limit and was NOT executed. Nothing was written. Retry with smaller content — e.g. write the file in a shorter form, or split the change across multiple write_file calls.',
          }))
          sess.messages.push({ role: 'user', content: truncated, ts: Date.now() })
          sse(res, { type: 'tool', name: 'retrying (output limit)' })
          continue
        }
        if (stopReason !== 'tool_use') break

        // execute every tool_use block, collect results into one user turn
        const results = []
        for (const block of assistantBlocks) {
          if (block.type !== 'tool_use') continue
          sse(res, { type: 'tool', name: block.name })
          let out, isErr = false
          try { out = runTool(block.name, block.input, (evt) => sse(res, evt)) }
          catch (e) { out = 'Error: ' + (e && e.message ? e.message : String(e)); isErr = true }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: String(out), is_error: isErr })
        }
        sess.messages.push({ role: 'user', content: results, ts: Date.now() })
      }
      sanitizeDanglingToolUse(sess)
      saveSession(sess)
      sse(res, { type: 'done' })
    } catch (e) {
      sanitizeDanglingToolUse(sess)
      saveSession(sess)
      sse(res, { type: 'error', message: (e && e.message) ? e.message : 'Coach request failed.' })
      sse(res, { type: 'done' })
    } finally {
      res.off('close', onClose)
    }
    res.end()
  }

  // A saved transcript must NEVER end with a tool_use that has no tool_result — the
  // next turn's API call would 400 forever ("tool_use ids found without tool_result"),
  // bricking the session. If the loop exited (guard, error, disconnect) mid-call,
  // answer the dangling calls with synthetic error results before persisting.
  function sanitizeDanglingToolUse(sess) {
    const last = sess.messages[sess.messages.length - 1]
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return
    const dangling = last.content.filter((b) => b && b.type === 'tool_use')
    if (!dangling.length) return
    sess.messages.push({
      role: 'user', ts: Date.now(),
      content: dangling.map((b) => ({
        type: 'tool_result', tool_use_id: b.id, is_error: true,
        content: 'INTERRUPTED: this tool call was never executed (the turn ended early). Nothing was written.',
      })),
    })
  }

  // ---------- vision photo ----------
  // Validate + persist a base64 image posted inside the chat body. Returns
  //   { media_type, data, path }  on success,
  //   { error }                   on a rejected image,
  //   null                        when there is effectively no image.
  // Also writes a JPEG copy to student/uploads/<YYYY-MM-DD-HHmmss>.jpg so the coach
  // can reference the shot by path in later turns (transcripts keep only the path).
  const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
  const IMAGE_B64_CAP = 6 * 1024 * 1024   // ~6MB of base64
  function acceptImage(image) {
    const mt = String(image.media_type || '')
    const data = typeof image.data === 'string' ? image.data : ''
    if (!data) return null
    if (!IMAGE_TYPES[mt]) return { error: 'Unsupported image type: ' + (mt || 'unknown') + ' (use JPEG, PNG, or WebP).' }
    if (data.length > IMAGE_B64_CAP) return { error: 'That image is too large — keep photos under ~6MB.' }
    let buf
    try { buf = Buffer.from(data, 'base64') } catch (e) { return { error: 'Could not decode the image data.' } }
    if (!buf.length) return { error: 'The image was empty.' }
    let relPath = ''
    try {
      const d = new Date(), pp = (n) => String(n).padStart(2, '0')
      const stamp = `${d.getFullYear()}-${pp(d.getMonth() + 1)}-${pp(d.getDate())}-${pp(d.getHours())}${pp(d.getMinutes())}${pp(d.getSeconds())}`
      const dir = resolve(root, 'student', 'uploads')
      mkdirSync(dir, { recursive: true })
      // save with the true extension (client downscales to JPEG, but accept PNG/WebP too);
      // random suffix so two photos in the SAME second don't overwrite each other
      const abs = join(dir, stamp + '-' + randomBytes(3).toString('hex') + '.' + IMAGE_TYPES[mt])
      writeFileSync(abs, buf)
      relPath = relative(root, abs).replace(/\\/g, '/')
    } catch (e) { /* saving is best-effort; still let the coach see the image */ }
    return { media_type: mt, data, path: relPath || 'student/uploads/(unsaved)' }
  }

  // ---------- take upload ----------
  // Save a raw recording (audio/webm or audio/*) posted from the drawer's mic to
  // student/recordings/<YYYY-MM-DD-HHmmss>.<ext>. 20MB cap. Returns {ok, path}.
  const UPLOAD_CAP = 20 * 1024 * 1024
  function handleUpload(req, res) {
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', (c) => {
      if (aborted) return
      size += c.length
      if (size > UPLOAD_CAP) {
        aborted = true
        res.statusCode = 413
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: 'recording exceeds 20MB cap' }))
        try { req.destroy() } catch (_) {}
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (aborted) return
      try {
        const buf = Buffer.concat(chunks)
        if (!buf.length) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'empty body' })); return }
        const ct = String(req.headers['content-type'] || '')
        const ext = ct.includes('ogg') ? 'ogg' : ct.includes('wav') ? 'wav' : ct.includes('mpeg') || ct.includes('mp3') ? 'mp3' : 'webm'
        const d = new Date(), p = (n) => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
        // optional label from the take name → filesystem-safe suffix
        const rawName = String(req.headers['x-take-name'] || '').trim()
        const label = rawName ? '-' + rawName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) : ''
        const dir = resolve(root, 'student', 'recordings')
        mkdirSync(dir, { recursive: true })
        // random suffix so two takes in the SAME second don't overwrite each other
        const abs = join(dir, stamp + label + '-' + randomBytes(3).toString('hex') + '.' + ext)
        writeFileSync(abs, buf)
        const relPath = relative(root, abs).replace(/\\/g, '/')
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, path: relPath }))
      } catch (e) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'save failed' }))
      }
    })
  }

  // ---------- session REST ----------
  function jsonRes(res, status, obj) {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
  }
  // Buffer a JSON request body with a hard byte cap. Over the cap → destroy the
  // socket and 413 (never let an authed client OOM the process by streaming a huge
  // POST). cb receives the parsed object; malformed JSON parses to {}.
  const JSON_BODY_CAP = 1 << 20 // 1MB — plenty for a session title / chat turn (images use base64 caps in acceptImage)
  function readJsonBody(req, res, cb) {
    let raw = ''
    let over = false
    req.on('data', (c) => {
      if (over) return
      raw += c
      if (raw.length > JSON_BODY_CAP) {
        over = true
        try { jsonRes(res, 413, { error: 'request body too large' }) } catch (_) {}
        try { req.destroy() } catch (_) {}
      }
    })
    req.on('end', () => { if (over) return; let b; try { b = JSON.parse(raw || '{}') } catch (e) { b = {} } cb(b) })
    req.on('error', () => { if (!over) { over = true; try { req.destroy() } catch (_) {} } })
  }
  // Dispatch /api/coach/sessions[/<id>] for GET/POST/PATCH/DELETE. `sub` is the tail
  // after '/api/coach' (e.g. '/sessions', '/sessions/abc123'), possibly with a query.
  function handleSessions(req, res, sub) {
    const path = sub.split('?')[0]                 // drop any query string
    const rest = path.slice('/sessions'.length)    // '' (collection) or '/<id>'
    const method = req.method || 'GET'

    // collection: GET (list) / POST (create)
    if (rest === '' || rest === '/') {
      if (method === 'GET') { jsonRes(res, 200, { sessions: listSessions() }); return }
      if (method === 'POST') {
        migrateLegacyOnce()
        readJsonBody(req, res, () => jsonRes(res, 200, sessionSummary(createSession('New session'))))
        return
      }
      jsonRes(res, 405, { error: 'Method not allowed.' })
      return
    }

    // item: /sessions/<id>
    const id = rest.slice(1)
    if (!validId(id)) { jsonRes(res, 400, { error: 'Bad session id.' }); return }

    if (method === 'GET') {
      const sess = loadSession(id)
      if (!sess) { jsonRes(res, 404, { error: 'No such session.' }); return }
      jsonRes(res, 200, { id: sess.id, title: sess.title || 'New session', messages: sessionForClient(sess) })
      return
    }
    if (method === 'PATCH') {
      const sess = loadSession(id)
      if (!sess) { jsonRes(res, 404, { error: 'No such session.' }); return }
      readJsonBody(req, res, (body) => {
        let title = String(body && body.title != null ? body.title : '').trim()
        if (!title) { jsonRes(res, 400, { error: 'Title required.' }); return }
        if (title.length > 80) title = title.slice(0, 80)
        sess.title = title
        saveSession(sess)
        jsonRes(res, 200, { ok: true, title: sess.title })
      })
      return
    }
    if (method === 'DELETE') {
      const ok = deleteSession(id)
      jsonRes(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: 'No such session.' })
      return
    }
    jsonRes(res, 405, { error: 'Method not allowed.' })
  }

  // The connect-style handler. Mounted WITHOUT prefix stripping, so it checks the
  // FULL req.url (e.g. '/api/coach', '/api/coach/upload'). Shared by the Vite dev
  // plugin (configureServer) and the standalone prod server (named `middleware`).
  function handler(req, res, next) {
    const url = req.url || ''
    if (!url.startsWith('/api/coach')) { next(); return }
    const sub = url.slice('/api/coach'.length)   // '', '/health', '/history', '/upload', or with a query string
    // guard the segment boundary so we never swallow a sibling route like /api/coachfoo
    if (sub && sub[0] !== '/' && sub[0] !== '?') { next(); return }
    // health
    if (req.method === 'GET' && (sub === '/health' || sub.startsWith('/health?'))) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, model: MODEL, keyed: !!client }))
      return
    }
    // history (legacy, backwards compat) — the most-recently-updated session's client turns
    if (req.method === 'GET' && (sub === '/history' || sub.startsWith('/history?'))) {
      res.setHeader('Content-Type', 'application/json')
      const latest = latestSession()
      res.end(JSON.stringify({ messages: latest ? sessionForClient(latest) : [] }))
      return
    }
    // session REST — checked BEFORE the bare POST chat match so /sessions never falls through to chat
    if (sub === '/sessions' || sub.startsWith('/sessions?') || sub.startsWith('/sessions/')) {
      handleSessions(req, res, sub)
      return
    }
    // take upload (raw audio body)
    if (req.method === 'POST' && (sub === '/upload' || sub.startsWith('/upload?'))) {
      handleUpload(req, res)
      return
    }
    // chat turn (SSE)
    if (req.method === 'POST' && (sub === '' || sub === '/' || sub.startsWith('?') || sub.startsWith('/?'))) {
      // The chat body may carry a base64 photo (acceptImage caps the decoded image at
      // ~6MB → ~8MB base64); cap the whole JSON envelope a bit above that so a huge
      // POST can't buffer unbounded into memory before we ever look at it.
      const CHAT_BODY_CAP = 10 * 1024 * 1024
      let raw = ''
      let over = false
      req.on('data', (c) => {
        if (over) return
        raw += c
        if (raw.length > CHAT_BODY_CAP) {
          over = true
          try { jsonRes(res, 413, { error: 'request body too large' }) } catch (_) {}
          try { req.destroy() } catch (_) {}
        }
      })
      req.on('error', () => { if (!over) { over = true; try { req.destroy() } catch (_) {} } })
      req.on('end', () => {
        if (over) return
        let body
        try { body = JSON.parse(raw || '{}') } catch (e) { body = {} }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')
        handleCoach(req, res, body).catch((e) => {
          try { sse(res, { type: 'error', message: (e && e.message) || 'error' }); sse(res, { type: 'done' }); res.end() } catch (_) {}
        })
      })
      return
    }
    next()
  }

  return { name: 'woodshed-coach', handler }
}

// Named export per the SHARED MIDDLEWARE CONTRACT: middleware(opts) → connect-style
// (req,res,next). opts = {apiKey?, root}. Mounted WITHOUT prefix stripping; it checks
// the full req.url itself. The standalone prod server imports THIS.
export function middleware(opts) {
  return coachBuild(opts).handler
}

// The Vite dev plugin: builds the handler and mounts it on the dev server's middleware
// stack (no prefix, so req.url stays the full '/api/coach…' path the handler expects).
export default function coachPlugin(opts) {
  const built = coachBuild(opts)
  return {
    name: 'woodshed-coach',
    configureServer(server) {
      server.middlewares.use(built.handler)
    },
  }
}
