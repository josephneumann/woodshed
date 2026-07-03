// Practice-stats sync API — GET/PUT /api/stats
// Exports a default Vite plugin AND a named middleware(opts) per the shared
// middleware contract (standalone prod server mounts the named export).
// Mirrors server/tones-plugin.js so serve.js can mount it the same way.
// No auth here — the prod server layer adds it.
//
// WHY this file exists: practice stats used to live only in per-device
// localStorage, so opening the app from a phone would fork the history. This
// makes student/practice-stats.json the shared truth. The file is DEVICE-BRANCHED:
// each device only ever overwrites its OWN branch under devices[<deviceId>], so
// re-pushing is idempotent and cross-device counters can never double-count.
//
//   { version:1, updated:'YYYY-MM-DD', devices:{ <deviceId>: {days,reviewQueue,lastPush} } }
//
// The client (tools/stats.js) MERGES all device branches' days on the fly for its
// read-side view; it only ever writes its own branch. The coach reads this file
// read-only and must merge across device branches (see AGENT-INTERFACE.md).

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const DATA_REL = 'student/practice-stats.json'
const MAX_BYTES = 2 * 1024 * 1024   // reject payloads over 2MB (matches spec)

function today() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

// The canonical empty doc — created lazily the first time anyone GETs the file.
function emptyDoc() {
  return { version: 1, updated: '', devices: {}, days: {}, reviewQueue: [] }
}

function loadData(root) {
  try {
    const doc = JSON.parse(readFileSync(resolve(root, DATA_REL), 'utf8'))
    if (!doc || typeof doc !== 'object') return emptyDoc()
    // normalize any missing top-level keys so callers never crash on a partial file
    if (!doc.devices || typeof doc.devices !== 'object') doc.devices = {}
    if (!doc.days || typeof doc.days !== 'object') doc.days = {}
    if (!Array.isArray(doc.reviewQueue)) doc.reviewQueue = []
    if (typeof doc.version !== 'number') doc.version = 1
    return doc
  } catch (e) {
    return emptyDoc()
  }
}

// Loose shape check for a PUT push: {deviceId, days:{}, reviewQueue:[]}.
function validate(body) {
  if (!body || typeof body !== 'object') return 'body object required'
  if (!body.deviceId || typeof body.deviceId !== 'string') return 'deviceId (string) required'
  if (!body.days || typeof body.days !== 'object' || Array.isArray(body.days)) return 'days object required'
  if (!Array.isArray(body.reviewQueue)) return 'reviewQueue array required'
  return null
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

// Coerce a pushed `days` map into the exact shape the CLIENTS' boot merge
// (tools/stats.js mergeDayMaps → mergeRec) can consume without throwing. This store
// is the shared truth: EVERY other device folds this branch in on boot, so one bad
// push (byKey value not an object, tempos/confirms not an array, a tool record that
// isn't an object) would throw inside mergeRec and break the read-side merge for
// every client. The server validate() only guarantees `days` is a non-array object;
// the nested records are un-typed, so we defensively normalize them here. Anything we
// can't make safe is dropped rather than stored. Pure, shape-preserving for good data.
function sanitizeDays(days) {
  const out = {}
  if (!isObj(days)) return out
  for (const day of Object.keys(days)) {
    const tools = days[day]
    if (!isObj(tools)) continue                 // a day must map tool -> record
    const dayOut = {}
    for (const tool of Object.keys(tools)) {
      const rec = tools[tool]
      if (!isObj(rec)) continue                 // mergeRec assumes a record object
      const r = {}
      for (const k of Object.keys(rec)) {
        const v = rec[k]
        if (k === 'byKey') {
          // byKey: { <key>: {a,c} } — every value MUST be an object (mergeRec reads .a/.c)
          if (!isObj(v)) continue
          const bk = {}
          for (const kk of Object.keys(v)) if (isObj(v[kk])) bk[kk] = v[kk]
          r.byKey = bk
        } else if (k === 'tempos' || k === 'confirms') {
          // spread as an array in mergeRec — must be iterable
          if (Array.isArray(v)) r[k] = v
        } else {
          r[k] = v                              // scalars (counters, ts, streaks) pass through
        }
      }
      dayOut[tool] = r
    }
    out[day] = dayOut
  }
  return out
}

// Atomic write: tmp file + rename so a crash mid-write never leaves the shared
// truth half-written. (The other plugins writeFileSync directly; this store is
// the merged history for every device, so we harden it.)
function saveData(root, doc) {
  doc.updated = today()
  const abs = resolve(root, DATA_REL)
  mkdirSync(dirname(abs), { recursive: true })
  const tmp = abs + '.tmp'
  writeFileSync(tmp, JSON.stringify(doc, null, 2))
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

  return function statsMiddleware(req, res, next) {
    const url = (req.url || '').split('?')[0]
    if (url !== '/api/stats') return next()

    if (req.method === 'GET') {
      json(res, loadData(root))
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      let raw = ''
      let over = false
      req.on('data', c => {
        if (over) return
        raw += c
        if (raw.length > MAX_BYTES) { over = true; json(res, { error: 'stats payload exceeds 2MB cap' }, 413); try { req.destroy() } catch (_) {} }
      })
      req.on('end', () => {
        if (over) return
        let body
        try { body = JSON.parse(raw || '{}') } catch (e) { json(res, { error: 'invalid JSON' }, 400); return }
        const err = validate(body)
        if (err) { json(res, { error: err }, 400); return }
        try {
          // The client overwrites ONLY its own branch — no cross-device summing here.
          // Sanitize the pushed days into the shape every other client's boot merge can
          // consume, so a malformed branch can't break cross-device reads (see sanitizeDays).
          const doc = loadData(root)
          doc.devices[body.deviceId] = { days: sanitizeDays(body.days), reviewQueue: body.reviewQueue, lastPush: Date.now() }
          saveData(root, doc)
          json(res, { ok: true, updated: doc.updated })
        } catch (e) {
          json(res, { error: 'write failed: ' + (e && e.message ? e.message : String(e)) }, 500)
        }
      })
      return
    }

    next()
  }
}

// Default export — Vite plugin that mounts the middleware on the dev server.
export default function statsPlugin(opts) {
  opts = opts || {}
  const root = opts.root || process.cwd()
  return {
    name: 'woodshed-stats',
    configureServer(server) {
      server.middlewares.use(middleware({ root }))
    },
  }
}
