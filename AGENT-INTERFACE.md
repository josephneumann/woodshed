# AGENT-INTERFACE — what The Instructor can touch, and how

> The contract between the embedded coach (server/coach-plugin.js + tools/coach.js)
> and every piece of Woodshed data. If a control exists in the app, this file says
> whether the agent can read it, write it, and by which path. Keep this current
> when adding tools or data stores.

## The two data worlds

**World 1 — files on disk** (server-owned; the same files Claude Code's /instructor
uses). The coach reaches these directly through server-side tools.

**World 2 — browser data** (client-owned: localStorage + IndexedDB). The server can
never touch these directly. Reads arrive as a context digest with every message;
writes travel as SSE `client` events that the open page applies via `Stats`.

## World 1 — files

| Data | Path | Agent access | Tool |
|---|---|---|---|
| Student profile, log, baseline, repertoire | student/*.md | read + write | read_file / write_file |
| Practice plan (hub renders it) | student/current-plan.json | read + write | read_file / write_file |
| Dashboard mirror | student/progress-data.json | read + write | read_file / write_file |
| Gear inventory (each item: `name`, `blurb` = one-line display, `specs`/`tags`, `notes` = detailed background written FOR the Instructor — circuit, tone, typical use/placement; read `notes` when reasoning about tone or the signal chain) | student/gear.json | read + write | read_file / write_file |
| Curriculum + syllabus | curriculum/*.md | read only | read_file |
| Course extracts, glossary | reference/*.md | read only | read_file |
| Resource Library | reference/resource-library.json | append only (dedup by URL) | add_resource |
| **Coach memory** (durable notes about the student, auto-loaded into every request's system prompt) | student/coach-memory.md | read + write | update_memory (append/replace) |
| **Repertoire queue** (song library; array order = priority; repertoire.html edits it via /api/repertoire) | student/repertoire.json | read + write (whole file) | read_file / write_file |
| **Tone presets** (Tone Studio rigs; page edits via /api/tones; board state arrives as context.tone) | student/tone-presets.json | read + write (append on confirm) | read_file / write_file |
| **Sound identity** (My Sound page — target tone/style; page edits via /api/identity; page state arrives as context.identity) | student/sound-identity.json | read + write (statement/influences on approval) | read_file / write_file |
| **Practice stats** (shared truth; every tool syncs its localStorage here via /api/stats so phone + desktop don't fork history) | student/practice-stats.json | **read only** — stats are EVIDENCE, never fabricated | read_file |
| **Session log** (one record per sitting — duration, steps done vs planned, per-tool numbers, grade+note, coachSessionId → debrief; app-written via /api/sessions, upsert by id) | student/sessions.json | **read** for history; may **amend** a record's grade/note | read_file / write_file (grade/note only) |
| Recordings (drawer mic takes; coach gets analysis text + path, cannot hear audio) | student/recordings/*.webm | receives analysis via context.take | POST /api/coach/upload (client) |
| Photo uploads (drawer camera / paste; coach SEES the image the turn it arrives, then a text marker) | student/uploads/&lt;YYYY-MM-DD-HHmmss&gt;.jpg | saved server-side from body.image; referenced by path in later turns | POST /api/coach body.image (client) |
| Conversations (one JSON file per session; full transcript kept, last 40 turns sent to the model) | student/coach-sessions/&lt;id&gt;.json | managed automatically + **readable** (see note) | read_file (own past sessions) |
| **Weekly briefing** (the coach's OWN lesson-plan file; dashboard renders it in a card; links written repo-root-relative `tools/x.html`) | student/briefing.md | read + write (coach maintains it) | read_file / write_file |
| Song audio + charts (Repertoire Workbench attachments; gitignored) | student/song-audio/ · student/charts/ | referenced by path in repertoire.json | POST /api/repertoire/upload (client) |
| Legacy conversation blobs (superseded by coach-sessions/; migrated once then renamed to coach-history.migrated.json) | student/coach-history.json · student/coach-archive.json | legacy — not written anymore | — |
| The web | — | search (max 5/turn) | web_search (server tool) |

Write scope is enforced server-side: write_file resolves inside student/ only,
add_resource may touch exactly reference/resource-library.json, path traversal is
rejected. The API key never leaves the server.

**Reading practice-stats.json (device-branched — merge required).** The file is the
shared practice truth synced from every device's localStorage via GET/PUT /api/stats.
It is NOT a flat day map: each device owns a branch under
`devices:{<deviceId>:{days,reviewQueue,lastPush}}`, so the same calendar day can appear
in several branches. To read a day's real total you MUST merge every branch's `days`:
per (day, tool) record — counters SUM (answered, correct, skipped, events, msSum,
msCount), bestStreak = MAX, firstTs = MIN, lastTs = MAX, byKey per-key {a,c} SUM,
tempos + confirms = concat deduped by ts. Days present in only one branch copy through.
Reading a single branch (or the top-level `days`, which may be empty) undercounts.
It is read-only to the coach — the app owns every write.

## World 2 — browser data (via the client bridge)

READ — every chat message carries `context`: page, title, localDate, plus a Stats
digest (today's record, streak days, weak keys for ear/fretboard, due reviews, and
any pending take from a debrief).

WRITE — server tools that emit SSE `{type:'client', action, ...}` events; the open
drawer applies them through `Stats` and they persist in localStorage:

| Control | Store | Agent tool | Applied as |
|---|---|---|---|
| Tool settings (metronome BPM, trainer modes…) | localStorage `toolPrefs` | set_pref(tool,key,value) | Stats.setPref |
| Review queue (Tomorrow's bench) | localStorage `reviewQueue` | schedule_review(tool,key,note) | Stats.review.add (due tomorrow) |
| Confirmations | localStorage `reviewQueue` + `practiceStats` | complete_review(tool,key,pass) | Stats.review.complete |
| Practice stats | localStorage `practiceStats` (this device's live branch) — ALSO file-visible at student/practice-stats.json | read-only by design — stats are EVIDENCE; the agent never fabricates them | — |
| Take archive | IndexedDB `woodshedTakes` | read via debrief context (`coach:open` passes the take report); no agent writes | — |
| Coach model choice | localStorage `coachModel` | user-owned (the amp knob); sent per request, whitelist-validated server-side | — |
| **Guided practice session** (bottom strip with countdown that follows the student across pages) | localStorage `wscPracticeSession` | start_practice_session({steps:[{tool,title,minutes,note}]}) ≤5 steps, 1–60 min each | coach.js renders + runs the strip |
| **Take data** (structured transcription: {source,durationSec,bpmGuess?,noteCount,notes[≤400],report}) | arrives per-message | read via context.take (transcribe.html attaches it) | — |

Bridge caveat: client writes apply in the page that sent the message. If the coach
is driven headless (curl), bridge tools no-op gracefully and say so.

## SSE protocol (drawer ⇄ sidecar)

`data: {"type":"session","id","title"}` (first event when a session is created or
auto-titled) · `{"type":"text","delta"}` · `{"type":"tool","name"}` ·
`{"type":"client","action","...payload"}` · `{"type":"done"}` ·
`{"type":"error","message"}`

POST /api/coach body: `{message, context, model?, sessionId?, reset?, image?}` — model must be
one of claude-sonnet-4-6 · claude-opus-4-6 · claude-opus-4-7 · claude-opus-4-8. A valid
`sessionId` appends to that session; absent/unknown creates one (emitted as the first
`session` event). `reset:true` clears the given session (legacy; the client no longer uses it).

`image` (optional) = `{media_type, data}` where `media_type` ∈ image/jpeg · image/png · image/webp
and `data` is base64 **without** the `data:` prefix (client downscales to ≤1568px long edge,
JPEG q.85, one image per message). The server validates the type and a ~6MB base64 cap, saves a
copy to student/uploads/, and builds the live user turn as a content array
`[{type:image,source:{base64…}}, {type:text,text: message+context}]`.
**Persistence marker rule:** the saved session file NEVER stores base64 — the image block is
replaced with the text `[photo attached: student/uploads/…jpg]`. Only the live API call for THAT
turn gets the real image; every resend (the last-40 window) and every re-read of the transcript
sees the marker. So the coach can see a photo only in the turn it arrives.

### Session REST (drawer's conversation list)

- `GET  /api/coach/sessions` → `{sessions:[{id,title,created,updated,count,preview}]}` (updated desc).
- `POST /api/coach/sessions` → creates `{id,title:'New session',…}`, returns the summary.
- `GET  /api/coach/sessions/<id>` → `{id,title,messages:[{role,text,ts?}]}` (text-only, tool/empty turns dropped).
- `PATCH /api/coach/sessions/<id>` body `{title}` → `{ok,title}` (trimmed, 1–80 chars).
- `DELETE /api/coach/sessions/<id>` → `{ok}`.
- `GET  /api/coach/history` (legacy) → the most-recently-updated session's client-render messages.

**The coach can read its own past sessions.** Every conversation is stored as its own
file under student/coach-sessions/<id>.json. When the student references an earlier
discussion, the coach may `read_file` an old session (`list_files "student/coach-sessions"`
to find it) to recover what was said — but it never writes those files directly; the app owns them.

## Design rules for new capabilities

1. New file data → put it under student/ and the coach already has it.
2. New browser control → add a `set_…`/`…_review`-style server tool that emits a
   `client` event, apply it in coach.js `applyClientAction`, and add a row here.
3. Stats stay read-only to the agent, always — rings ink on evidence (PRODUCT-SPEC
   law: ceremony never lies).
