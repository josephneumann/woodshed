// Lick Library API — GET/PUT /api/licks
// Exports a default Vite plugin AND a named middleware(opts) per the shared
// middleware contract (standalone prod server mounts the named export).
// Mirrors server/tones-plugin.js so serve.js can mount it the same way.
// No auth here — the prod server layer adds it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const DATA_REL = 'student/licks.json'
const MAX_BYTES = 2 * 1024 * 1024   // ~2MB cap on the serialized document

function today() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function loadData(root) {
  try { return JSON.parse(readFileSync(resolve(root, DATA_REL), 'utf8')) }
  catch (e) { return { version: 1, updated: today(), licks: [] } }
}

// Loose validation: the document must carry a licks array, and every lick must
// have an id, a name, and a notes array. Everything else is free text / optional.
function validate(body) {
  if (!body || typeof body !== 'object') return 'object body required'
  if (!Array.isArray(body.licks)) return 'licks array required'
  for (const l of body.licks) {
    if (!l || typeof l !== 'object') return 'each lick must be an object'
    if (!l.id || !l.name) return 'each lick must have id and name'
    if (!Array.isArray(l.notes)) return 'each lick must have a notes array'
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

// Named export — connect-style middleware, full path check (no prefix stripping).
export function middleware(opts) {
  opts = opts || {}
  const root = opts.root || process.cwd()

  return function licksMiddleware(req, res, next) {
    const url = (req.url || '').split('?')[0]
    if (url !== '/api/licks') return next()

    if (req.method === 'GET') {
      json(res, loadData(root))
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      let raw = ''
      let over = false
      req.on('data', c => {
        raw += c
        if (raw.length > MAX_BYTES) { over = true; try { req.destroy() } catch (e) {} }
      })
      req.on('end', () => {
        if (over) { json(res, { error: 'payload too large (max ~2MB)' }, 413); return }
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
      req.on('error', () => { json(res, { error: 'request stream error' }, 400) })
      return
    }

    next()
  }
}

// Default export — Vite plugin that mounts the middleware on the dev server.
export default function licksPlugin(opts) {
  opts = opts || {}
  const root = opts.root || process.cwd()
  return {
    name: 'woodshed-licks',
    configureServer(server) {
      server.middlewares.use(middleware({ root }))
    },
  }
}
