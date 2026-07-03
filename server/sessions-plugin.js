// Practice-session records API — GET/POST /api/sessions
// Exports a default Vite plugin AND a named middleware(opts) per the shared
// middleware contract (standalone prod server mounts the named export).
// Mirrors server/stats-plugin.js so serve.js can mount it the same way.
// No auth here — the prod server layer adds it.
//
// WHY this file exists: a practice sitting is now a FIRST-CLASS record — one entry
// per session (duration, steps done vs planned, per-tool numbers, an optional
// grade+note, and a coachSessionId linking to the debrief conversation). This is the
// human-readable NARRATIVE of practice history; practice-stats.json is the raw exhaust
// behind it. The client (tools/session.html + tools/coach.js) is written against the
// contract below; the coach reads student/sessions.json for history and may amend a
// record's grade/note.
//
//   { version:1, sessions:[ {id,date,minutes,source,...} ] }
//
// Upsert by id: same id replaces (the grade ceremony amends a record), new id appends.
// The array stays sorted by date then startedAt, and is capped at 2000 records.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const DATA_REL = 'student/sessions.json'
const MAX_BYTES = 2 * 1024 * 1024   // reject payloads over 2MB (matches spec)
const MAX_RECORDS = 2000            // cap the stored array; drop oldest beyond this
const MAX_BATCH = 200               // a POST batch (one-time localStorage migration) is ≤200 records

// The canonical empty doc — created lazily the first time anyone writes the file.
function emptyDoc() {
  return { version: 1, sessions: [] }
}

function loadData(root) {
  try {
    const doc = JSON.parse(readFileSync(resolve(root, DATA_REL), 'utf8'))
    if (!doc || typeof doc !== 'object') return emptyDoc()
    if (!Array.isArray(doc.sessions)) doc.sessions = []
    if (typeof doc.version !== 'number') doc.version = 1
    return doc
  } catch (e) {
    return emptyDoc()
  }
}

// ---------- validation ----------
// Every field is validated; anything failing → a 400 naming the field, never a
// crash, never a partial write. validateRecord returns a CLEANED record on success
// or { error } on failure (the error message names the offending field).

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g
const ID_RE = /^s-[a-z0-9-]{6,60}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const COACH_ID_RE = /^[a-z0-9-]{4,24}$/
const SOURCES = new Set(['guided', 'logged', 'derived'])

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)
// strip control chars from a string, then cap its length
function cleanStr(v, max) {
  return String(v == null ? '' : v).replace(CONTROL_CHARS, '').slice(0, max)
}

function validateStep(s, i) {
  if (!isObj(s)) return { error: `steps[${i}] must be an object` }
  const out = {}
  if (s.tool == null) return { error: `steps[${i}].tool is required` }
  if (typeof s.tool !== 'string') return { error: `steps[${i}].tool must be a string` }
  out.tool = cleanStr(s.tool, 60)
  if (s.title == null) return { error: `steps[${i}].title is required` }
  if (typeof s.title !== 'string') return { error: `steps[${i}].title must be a string` }
  out.title = cleanStr(s.title, 160)
  if (!isFiniteNum(s.minutes)) return { error: `steps[${i}].minutes must be a number` }
  if (s.minutes < 0 || s.minutes > 120) return { error: `steps[${i}].minutes must be 0..120` }
  out.minutes = Math.round(s.minutes)
  if (typeof s.completed !== 'boolean') return { error: `steps[${i}].completed must be a boolean` }
  out.completed = s.completed
  if (s.planItemId != null) {
    if (typeof s.planItemId !== 'string') return { error: `steps[${i}].planItemId must be a string` }
    out.planItemId = cleanStr(s.planItemId, 60)
  }
  return { value: out }
}

// toolStats: object ≤30 keys, each value an object with only numeric values ≤12 keys.
function validateToolStats(ts) {
  if (!isObj(ts)) return { error: 'toolStats must be an object' }
  const keys = Object.keys(ts)
  if (keys.length > 30) return { error: 'toolStats may have at most 30 keys' }
  const out = {}
  for (const k of keys) {
    const v = ts[k]
    if (!isObj(v)) return { error: `toolStats["${k}"] must be an object` }
    const vk = Object.keys(v)
    if (vk.length > 12) return { error: `toolStats["${k}"] may have at most 12 keys` }
    const inner = {}
    for (const kk of vk) {
      if (!isFiniteNum(v[kk])) return { error: `toolStats["${k}"]["${kk}"] must be numeric` }
      inner[cleanStr(kk, 60)] = v[kk]
    }
    out[cleanStr(k, 60)] = inner
  }
  return { value: out }
}

function validateRecord(rec) {
  if (!isObj(rec)) return { error: 'each record must be an object' }
  const out = {}

  // id (REQUIRED) ^s-[a-z0-9-]{6,60}$
  if (rec.id == null) return { error: 'id is required' }
  if (typeof rec.id !== 'string' || !ID_RE.test(rec.id)) return { error: 'id must match ^s-[a-z0-9-]{6,60}$' }
  out.id = rec.id

  // date (REQUIRED) ^\d{4}-\d{2}-\d{2}$
  if (rec.date == null) return { error: 'date is required' }
  if (typeof rec.date !== 'string' || !DATE_RE.test(rec.date)) return { error: 'date must be YYYY-MM-DD' }
  out.date = rec.date

  // startedAt, endedAt (optional): finite positive numbers
  if (rec.startedAt != null) {
    if (!isFiniteNum(rec.startedAt) || rec.startedAt <= 0) return { error: 'startedAt must be a finite positive number' }
    out.startedAt = rec.startedAt
  }
  if (rec.endedAt != null) {
    if (!isFiniteNum(rec.endedAt) || rec.endedAt <= 0) return { error: 'endedAt must be a finite positive number' }
    out.endedAt = rec.endedAt
  }

  // minutes (REQUIRED) 0..600, round to int
  if (rec.minutes == null) return { error: 'minutes is required' }
  if (!isFiniteNum(rec.minutes)) return { error: 'minutes must be a number' }
  if (rec.minutes < 0 || rec.minutes > 600) return { error: 'minutes must be 0..600' }
  out.minutes = Math.round(rec.minutes)

  // source (REQUIRED) 'guided'|'logged'|'derived'
  if (rec.source == null) return { error: 'source is required' }
  if (typeof rec.source !== 'string' || !SOURCES.has(rec.source)) return { error: "source must be 'guided', 'logged', or 'derived'" }
  out.source = rec.source

  // phase (optional, default '') ≤200 chars
  if (rec.phase != null) {
    if (typeof rec.phase !== 'string') return { error: 'phase must be a string' }
    if (rec.phase.length > 200) return { error: 'phase must be ≤200 chars' }
    out.phase = cleanStr(rec.phase, 200)
  } else {
    out.phase = ''
  }

  // steps (optional, default []) array ≤20
  if (rec.steps != null) {
    if (!Array.isArray(rec.steps)) return { error: 'steps must be an array' }
    if (rec.steps.length > 20) return { error: 'steps may have at most 20 items' }
    const steps = []
    for (let i = 0; i < rec.steps.length; i++) {
      const r = validateStep(rec.steps[i], i)
      if (r.error) return { error: r.error }
      steps.push(r.value)
    }
    out.steps = steps
  } else {
    out.steps = []
  }

  // toolStats (optional, default {})
  if (rec.toolStats != null) {
    const r = validateToolStats(rec.toolStats)
    if (r.error) return { error: r.error }
    out.toolStats = r.value
  } else {
    out.toolStats = {}
  }

  // coachSessionId (optional) ^[a-z0-9-]{4,24}$
  if (rec.coachSessionId != null) {
    if (typeof rec.coachSessionId !== 'string' || !COACH_ID_RE.test(rec.coachSessionId)) return { error: 'coachSessionId must match ^[a-z0-9-]{4,24}$' }
    out.coachSessionId = rec.coachSessionId
  }

  // grade (optional) ≤24 chars
  if (rec.grade != null) {
    if (typeof rec.grade !== 'string') return { error: 'grade must be a string' }
    if (rec.grade.length > 24) return { error: 'grade must be ≤24 chars' }
    out.grade = cleanStr(rec.grade, 24)
  }

  // note (optional) ≤500 chars
  if (rec.note != null) {
    if (typeof rec.note !== 'string') return { error: 'note must be a string' }
    if (rec.note.length > 500) return { error: 'note must be ≤500 chars' }
    out.note = cleanStr(rec.note, 500)
  }

  return { value: out }
}

// Sort by date (YYYY-MM-DD lexical == chronological) then startedAt (missing sorts first).
function sortSessions(arr) {
  arr.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    const sa = isFiniteNum(a.startedAt) ? a.startedAt : -Infinity
    const sb = isFiniteNum(b.startedAt) ? b.startedAt : -Infinity
    return sa - sb
  })
  return arr
}

// Upsert one cleaned record into the array by id: same id replaces, new id appends.
function upsert(arr, rec) {
  const i = arr.findIndex((r) => r && r.id === rec.id)
  if (i >= 0) arr[i] = rec
  else arr.push(rec)
}

// Atomic write: tmp file + rename so a crash mid-write never leaves the session log
// half-written. Pretty-printed 2-space + trailing newline (the client expects it).
function saveData(root, doc) {
  const abs = resolve(root, DATA_REL)
  mkdirSync(dirname(abs), { recursive: true })
  const tmp = abs + '.tmp'
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
  renameSync(tmp, abs)
}

function json(res, obj, status) {
  res.statusCode = status || 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}

// Named export — connect-style middleware, full path check (no prefix stripping).
export function middleware(opts) {
  opts = opts || {}
  const root = opts.root || process.cwd()

  return function sessionsMiddleware(req, res, next) {
    const url = (req.url || '').split('?')[0]
    if (url !== '/api/sessions') return next()

    if (req.method === 'GET') {
      json(res, { sessions: loadData(root).sessions })
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      let raw = ''
      let over = false
      req.on('data', c => {
        if (over) return
        raw += c
        if (raw.length > MAX_BYTES) { over = true; json(res, { error: 'sessions payload exceeds 2MB cap' }, 413); try { req.destroy() } catch (_) {} }
      })
      req.on('end', () => {
        if (over) return
        let body
        try { body = JSON.parse(raw || '{}') } catch (e) { json(res, { error: 'invalid JSON' }, 400); return }

        // The body is ONE record object OR a { sessions:[...] } batch. Collect the
        // incoming records, validating each; any failure → 400 naming the field.
        let incoming
        if (isObj(body) && Array.isArray(body.sessions)) {
          if (body.sessions.length > MAX_BATCH) { json(res, { error: `batch may have at most ${MAX_BATCH} records` }, 400); return }
          incoming = body.sessions
        } else if (isObj(body)) {
          incoming = [body]
        } else {
          json(res, { error: 'body must be a record object or {sessions:[...]}' }, 400); return
        }

        const cleaned = []
        for (let i = 0; i < incoming.length; i++) {
          const r = validateRecord(incoming[i])
          if (r.error) { json(res, { error: (incoming.length > 1 ? `sessions[${i}]: ` : '') + r.error }, 400); return }
          cleaned.push(r.value)
        }

        try {
          const doc = loadData(root)
          for (const rec of cleaned) upsert(doc.sessions, rec)
          sortSessions(doc.sessions)
          if (doc.sessions.length > MAX_RECORDS) {
            const drop = doc.sessions.length - MAX_RECORDS
            console.warn(`[woodshed] sessions: dropping ${drop} oldest record(s) — over the ${MAX_RECORDS} cap`)
            doc.sessions = doc.sessions.slice(drop)   // sorted ascending → oldest first
          }
          saveData(root, doc)
          json(res, { ok: true, count: doc.sessions.length })
        } catch (e) {
          json(res, { error: 'write failed: ' + (e && e.message ? e.message : String(e)) }, 500)
        }
      })
      req.on('error', () => { if (!over) { over = true; try { req.destroy() } catch (_) {} } })
      return
    }

    next()
  }
}

// Default export — Vite plugin that mounts the middleware on the dev server.
export default function sessionsPlugin(opts) {
  opts = opts || {}
  const root = opts.root || process.cwd()
  return {
    name: 'woodshed-sessions',
    configureServer(server) {
      server.middlewares.use(middleware({ root }))
    },
  }
}
