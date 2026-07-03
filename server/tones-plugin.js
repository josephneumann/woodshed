// Tone presets API — GET/PUT /api/tones
// Exports a default Vite plugin AND a named middleware(opts) per the shared
// middleware contract (standalone prod server mounts the named export).
// Mirrors server/repertoire-plugin.js exactly so serve.js can mount it the same way.
// No auth here — the prod server layer adds it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const DATA_REL = 'student/tone-presets.json'
const MAX_BYTES = 2 * 1024 * 1024   // cap the JSON PUT body so a huge post can't buffer unbounded

function today() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function loadData(root) {
  try { return JSON.parse(readFileSync(resolve(root, DATA_REL), 'utf8')) }
  catch (e) { return { version: 1, updated: today(), presets: [] } }
}

function validate(body) {
  if (!body || !Array.isArray(body.presets)) return 'presets array required'
  for (const p of body.presets) {
    if (!p.id || !p.name) return 'each preset must have id and name'
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

  return function tonesMiddleware(req, res, next) {
    const url = (req.url || '').split('?')[0]
    if (url !== '/api/tones') return next()

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
export default function tonesPlugin(opts) {
  opts = opts || {}
  const root = opts.root || process.cwd()
  return {
    name: 'woodshed-tones',
    configureServer(server) {
      server.middlewares.use(middleware({ root }))
    },
  }
}
