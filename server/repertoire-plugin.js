// Repertoire queue API — GET/PUT /api/repertoire  +  POST /api/repertoire/upload
// Exports a default Vite plugin AND a named middleware(opts) per the shared
// middleware contract (standalone prod server mounts the named export).
// No auth here — the prod server layer adds it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

const DATA_REL = 'student/repertoire.json'
const MAX_BYTES = 2 * 1024 * 1024   // cap the JSON PUT body so a huge post can't buffer unbounded

function today() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function loadData(root) {
  try { return JSON.parse(readFileSync(resolve(root, DATA_REL), 'utf8')) }
  catch (e) { return { version: 1, updated: today(), items: [] } }
}

function validate(body) {
  if (!body || !Array.isArray(body.items)) return 'items array required'
  for (const item of body.items) {
    if (!item.id || !item.title) return 'each item must have id and title'
  }
  return null
}

function saveData(root, data) {
  data.updated = today()
  const abs = resolve(root, DATA_REL)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(data, null, 2))
}

function json(res, obj, status) {
  res.statusCode = status || 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}

// ---------- upload ----------
// Accepts JSON {name, mime, data(base64)}. Audio → student/song-audio/, charts
// (image/pdf) → student/charts/. Filenames are stripped to [a-z0-9-_.] (traversal-proof)
// and stamped with the local date. Mirrors coach-plugin's acceptImage/handleUpload style,
// including a body-size cap enforced on the request stream so a huge post can't buffer.
const AUDIO_MIME = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
}
const CHART_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf',
}
// ~25MB decoded → base64 inflates ~4/3, so cap the raw request body a bit above that.
const DECODED_CAP = 25 * 1024 * 1024
const BODY_CAP = Math.ceil(DECODED_CAP * 4 / 3) + (1 << 20)  // base64 overhead + JSON envelope slack

// Strip a client-supplied filename to a safe stem: lowercase, only [a-z0-9-_.],
// no leading dots (so ".." / hidden files are impossible), length-capped. Never
// keeps a client-supplied extension — the caller appends the mime-derived one.
function safeStem(name) {
  let base = String(name || '').split(/[\\/]/).pop()   // drop any path portion
  base = base.replace(/\.[^.]*$/, '')                  // drop the extension
  base = base.toLowerCase().replace(/[^a-z0-9-_.]+/g, '-').replace(/^[.\-_]+|[.\-_]+$/g, '')
  base = base.slice(0, 48)
  return base || 'clip'
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function handleUpload(root, req, res) {
  let raw = ''
  let size = 0
  let aborted = false
  req.on('data', (c) => {
    if (aborted) return
    size += c.length
    if (size > BODY_CAP) {
      aborted = true
      json(res, { ok: false, error: 'upload exceeds ~25MB cap' }, 413)
      try { req.destroy() } catch (_) {}
      return
    }
    raw += c
  })
  req.on('end', () => {
    if (aborted) return
    let body
    try { body = JSON.parse(raw || '{}') } catch (e) { json(res, { ok: false, error: 'invalid JSON' }, 400); return }
    const mime = String(body.mime || '').toLowerCase()
    const b64 = typeof body.data === 'string' ? body.data : ''
    if (!b64) { json(res, { ok: false, error: 'no data' }, 400); return }

    let subdir, ext
    if (AUDIO_MIME[mime]) { subdir = 'song-audio'; ext = AUDIO_MIME[mime] }
    else if (CHART_MIME[mime]) { subdir = 'charts'; ext = CHART_MIME[mime] }
    else { json(res, { ok: false, error: 'unsupported mime: ' + (mime || 'unknown') }, 415); return }

    let buf
    try { buf = Buffer.from(b64, 'base64') } catch (e) { json(res, { ok: false, error: 'could not decode data' }, 400); return }
    if (!buf.length) { json(res, { ok: false, error: 'empty file' }, 400); return }
    if (buf.length > DECODED_CAP) { json(res, { ok: false, error: 'file exceeds ~25MB decoded' }, 413); return }

    try {
      const dir = resolve(root, 'student', subdir)
      mkdirSync(dir, { recursive: true })
      // random suffix so two uploads in the SAME second (same stem) don't overwrite each other
      const fname = stamp() + '-' + safeStem(body.name) + '-' + randomBytes(3).toString('hex') + '.' + ext
      const abs = resolve(dir, fname)
      // defence-in-depth: confirm the resolved path is still inside the target dir
      if (abs !== resolve(dir, fname) || !abs.startsWith(dir)) { json(res, { ok: false, error: 'bad path' }, 400); return }
      writeFileSync(abs, buf)
      json(res, { ok: true, path: 'student/' + subdir + '/' + fname })
    } catch (e) {
      json(res, { ok: false, error: 'save failed: ' + (e && e.message ? e.message : String(e)) }, 500)
    }
  })
}

// Named export — connect-style middleware, full path check (no prefix stripping).
export function middleware(opts) {
  opts = opts || {}
  const root = opts.root || process.cwd()

  return function repertoireMiddleware(req, res, next) {
    const url = (req.url || '').split('?')[0]

    // upload endpoint (audio + charts)
    if (url === '/api/repertoire/upload') {
      if (req.method === 'POST') { handleUpload(root, req, res); return }
      json(res, { ok: false, error: 'method not allowed' }, 405)
      return
    }

    if (url !== '/api/repertoire') return next()

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
        if (raw.length > MAX_BYTES) { over = true; json(res, { error: 'payload too large (max ~2MB)' }, 413); try { req.destroy() } catch (_) {} }
      })
      req.on('end', () => {
        if (over) return
        let body
        try { body = JSON.parse(raw || '{}') } catch (e) { json(res, { error: 'invalid JSON' }, 400); return }
        const err = validate(body)
        if (err) { json(res, { error: err }, 400); return }
        try {
          saveData(root, body)
          json(res, { ok: true, updated: body.updated })
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
export default function repertoirePlugin(opts) {
  opts = opts || {}
  const root = opts.root || process.cwd()
  return {
    name: 'woodshed-repertoire',
    configureServer(server) {
      server.middlewares.use(middleware({ root }))
    },
  }
}
