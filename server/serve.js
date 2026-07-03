// The Woodshed — hardened standalone server.
//
//   npm run build && npm start
//
// Serves the whole built app (dist/) plus the live student/reference/curriculum
// files on ONE port, everything behind a username + password. Plain node:http, no
// framework. Designed to sit behind Caddy on a small VPS (Caddy terminates TLS and
// reverse-proxies to localhost:PORT) — see DEPLOY.md.
//
// Auth model (single user, personal data): scrypt password hash in .env, HttpOnly +
// SameSite=Lax + Secure session cookie, 30-day rolling sessions persisted to
// .sessions.json, 5-failures/15min login rate limit, timing-safe compares. The
// Anthropic API key lives only here, server-side, and is handed to the coach +
// repertoire middleware.

import http from 'node:http'
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { resolve, join, normalize, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  verifyPassword, safeEqual, Sessions, parseCookies, cookie,
  rateLimiter, SESSION_COOKIE,
} from './auth.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')

// ---------- config (.env manual parse; no dotenv dep) ----------
function loadEnvFile(path) {
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 0) continue
      const k = t.slice(0, i).trim()
      let v = t.slice(i + 1).trim()
      // strip matching surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (k && process.env[k] === undefined) process.env[k] = v
    }
  } catch (e) { /* no .env — rely on process.env */ }
}
loadEnvFile(resolve(ROOT, '.env'))

const PORT = Number(process.env.PORT) || 8787
const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const WOODSHED_USER = process.env.WOODSHED_USER || ''
const WOODSHED_PASS_HASH = process.env.WOODSHED_PASS_HASH || ''
const SECURE = process.env.WOODSHED_SECURE !== '0'

const DIST = resolve(ROOT, 'dist')
// Live repo directories the browser fetches by literal path (../student/... etc.) and
// that are NOT copied into dist. These stay files-as-truth on disk (see DEPLOY.md).
const LIVE_DIRS = new Set(['student', 'reference', 'curriculum'])

// ---------- middleware wiring (shared contract) ----------
// Each server feature exports a named middleware(opts) returning (req,res,next).
// We import defensively: a missing/malformed export must not crash the boot — it
// disables that feature with a clear log line instead.
async function loadMiddleware(mod, name, opts) {
  try {
    const m = await import(mod)
    if (typeof m.middleware === 'function') return m.middleware(opts)
    console.warn(`[woodshed] ${name}: no named 'middleware' export found in ${mod} — feature disabled. (The module must export middleware(opts) per the shared contract.)`)
  } catch (e) {
    console.warn(`[woodshed] ${name}: could not load ${mod} — feature disabled. (${e && e.message ? e.message : e})`)
  }
  return null
}

// ---------- static serving ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
}
function mimeFor(p) { return MIME[extname(p).toLowerCase()] || 'application/octet-stream' }

// Resolve a URL path to a real file inside baseDir, traversal-proof. Returns an
// absolute path to a regular file, or null (not found / escapes / is a directory).
function resolveStatic(baseDir, urlPath) {
  // decode + strip query, normalize slashes
  let p
  try { p = decodeURIComponent(urlPath.split('?')[0]) } catch (e) { return null }
  p = p.replace(/\\/g, '/')
  if (p.includes('\0')) return null
  // normalize away ./ and ../ then confirm containment
  const rel = normalize(p).replace(/^([/\\])+/, '')
  const abs = resolve(baseDir, rel)
  const baseWithSep = baseDir.endsWith(sep) ? baseDir : baseDir + sep
  if (abs !== baseDir && !abs.startsWith(baseWithSep)) return null // escaped
  try {
    const st = statSync(abs)
    if (st.isDirectory()) return null // no directory listings
    if (!st.isFile()) return null
    return abs
  } catch (e) { return null }
}

function sendFile(res, absPath, { cache } = {}) {
  const headers = { 'Content-Type': mimeFor(absPath) }
  try { headers['Content-Length'] = statSync(absPath).size } catch (e) {}
  headers['Cache-Control'] = cache || 'no-cache'
  res.writeHead(200, headers)
  const stream = createReadStream(absPath)
  stream.on('error', () => { try { res.destroy() } catch (_) {} })
  stream.pipe(res)
}

// Try dist first, then repo-root, for /assets/* (hashed bundles live in dist; literal
// runtime assets like /assets/plates/*.png, /assets/stamps/*.png, /assets/woodshed-mark.svg
// live in the repo assets/ and are NOT copied into dist by the build).
function serveAsset(res, urlPath) {
  let abs = resolveStatic(join(DIST, 'assets'), urlPath.replace(/^\/assets/, ''))
  if (!abs) abs = resolveStatic(join(ROOT, 'assets'), urlPath.replace(/^\/assets/, ''))
  if (!abs) return false
  // hashed dist bundles are content-addressed → long cache; repo assets → short cache
  const cache = /-[A-Za-z0-9_]{8}\.[a-z0-9]+$/.test(abs) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'
  sendFile(res, abs, { cache })
  return true
}

// ---------- security headers ----------
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  if (SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

// ---------- helpers ----------
function clientIp(req) {
  // Behind Caddy, the real IP arrives via X-Forwarded-For. Trust the first hop only.
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim()
  return (req.socket && req.socket.remoteAddress) || 'unknown'
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolveP) => {
    let raw = ''
    let over = false
    req.on('data', (c) => { raw += c; if (raw.length > limit) { over = true; req.destroy() } })
    req.on('end', () => resolveP(over ? '' : raw))
    req.on('error', () => resolveP(''))
  })
}

// ---------- login page (self-contained; espresso/cream Woodshed palette) ----------
function loginPage({ error } = {}) {
  const errBlock = error ? `<p class="err">${error}</p>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Woodshed</title>
<style>
  :root{ --espresso:#2b1d12; --cream:#f1e7d3; --amber:#c8892b; --line:#5a4632; }
  *{ box-sizing:border-box; }
  html,body{ height:100%; margin:0; }
  body{
    background:var(--espresso);
    color:var(--cream);
    font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px;
  }
  .card{ width:100%; max-width:360px; text-align:center; }
  .mark{ width:52px; height:59px; display:block; margin:0 auto 14px; filter:drop-shadow(0 4px 10px rgba(0,0,0,.35)); }
  .kicker{ text-transform:uppercase; letter-spacing:.22em; font-size:11px; opacity:.6; margin:0 0 6px; }
  h1{
    font-family:'Fraunces',Georgia,'Times New Roman',serif;
    font-weight:600; font-size:38px; margin:0 0 26px; letter-spacing:.01em;
  }
  form{ display:flex; flex-direction:column; gap:12px; text-align:left; }
  label{ font-size:12px; letter-spacing:.04em; opacity:.75; }
  input{
    width:100%; padding:11px 13px; border-radius:8px;
    border:1px solid var(--line); background:#22160d; color:var(--cream);
    font-size:15px; font-family:inherit;
  }
  input:focus{ outline:none; border-color:var(--amber); }
  button{
    margin-top:8px; padding:12px; border:0; border-radius:8px; cursor:pointer;
    background:var(--amber); color:#22160d; font-weight:600; font-size:15px; font-family:inherit;
    letter-spacing:.02em;
  }
  button:hover{ filter:brightness(1.06); }
  .err{ color:#e6a; background:rgba(200,60,80,.12); border:1px solid rgba(200,60,80,.35);
    padding:9px 12px; border-radius:8px; font-size:13px; margin:0 0 4px; }
  .foot{ margin-top:20px; font-size:11px; opacity:.4; }
</style>
</head>
<body>
  <main class="card">
    <svg class="mark" viewBox="0 0 64 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M32 69 C 19 57, 6 39, 6 24 C 6 10, 16 4, 32 4 C 48 4, 58 10, 58 24 C 58 39, 45 57, 32 69 Z"
            fill="var(--espresso)" stroke="var(--amber)" stroke-width="3.5" stroke-linejoin="round"/>
      <text x="32" y="34" text-anchor="middle" dominant-baseline="central"
            font-family="'Fraunces',Georgia,'Times New Roman',serif" font-weight="600" font-size="30"
            fill="var(--cream)">W</text>
    </svg>
    <p class="kicker">Practice room</p>
    <h1>The Woodshed</h1>
    <form id="f" method="post" action="/api/login" autocomplete="on">
      ${errBlock}
      <div><label for="user">Name</label><input id="user" name="user" autocomplete="username" autofocus></div>
      <div><label for="pass">Password</label><input id="pass" name="pass" type="password" autocomplete="current-password"></div>
      <button type="submit">Enter</button>
    </form>
    <p class="foot">Local-first &middot; your data stays yours</p>
  </main>
<script>
  // Submit as JSON so the API handles both form and fetch clients identically.
  document.getElementById('f').addEventListener('submit', function (e) {
    e.preventDefault();
    var b = document.querySelector('button'); b.disabled = true; b.textContent = 'Checking…';
    fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: document.getElementById('user').value, pass: document.getElementById('pass').value }),
    }).then(function (r) {
      if (r.ok) { window.location.href = '/'; return; }
      return r.json().catch(function(){return {};}).then(function (d) {
        b.disabled = false; b.textContent = 'Enter';
        var p = document.querySelector('.err');
        if (!p) { p = document.createElement('p'); p.className = 'err'; e.target.insertBefore(p, e.target.firstChild); }
        p.textContent = (r.status === 429) ? 'Too many attempts. Wait a few minutes.' : (d.error || 'Wrong name or password.');
      });
    }).catch(function () { b.disabled = false; b.textContent = 'Enter'; });
  });
</script>
</body>
</html>`
}

// ---------- boot ----------
async function main() {
  if (!WOODSHED_USER || !WOODSHED_PASS_HASH) {
    console.warn('[woodshed] WARNING: WOODSHED_USER / WOODSHED_PASS_HASH not set — login will reject everyone.')
    console.warn("           Generate a hash:  npm run hash-pass 'your password'   then put it in .env")
  }
  if (!API_KEY) console.warn('[woodshed] WARNING: ANTHROPIC_API_KEY not set — the coach will be offline.')
  if (!existsSync(DIST)) {
    console.error('[woodshed] dist/ not found — run `npm run build` first.')
    process.exit(1)
  }

  const sessions = new Sessions({ root: ROOT })
  const limiter = rateLimiter({ max: 5, windowMs: 15 * 60 * 1000 })

  // Authed feature middleware (imported defensively per the shared contract).
  const coachMw = await loadMiddleware('./coach-plugin.js', 'coach', { apiKey: API_KEY, root: ROOT })
  const repertoireMw = await loadMiddleware('./repertoire-plugin.js', 'repertoire', { apiKey: API_KEY, root: ROOT })
  const tonesMw = await loadMiddleware('./tones-plugin.js', 'tones', { apiKey: API_KEY, root: ROOT })
  const gearMw = await loadMiddleware('./gear-plugin.js', 'gear', { apiKey: API_KEY, root: ROOT })
  const identityMw = await loadMiddleware('./identity-plugin.js', 'identity', { apiKey: API_KEY, root: ROOT })
  const statsMw = await loadMiddleware('./stats-plugin.js', 'stats', { apiKey: API_KEY, root: ROOT })
  const licksMw = await loadMiddleware('./licks-plugin.js', 'licks', { apiKey: API_KEY, root: ROOT })
  const sessionsMw = await loadMiddleware('./sessions-plugin.js', 'sessions', { apiKey: API_KEY, root: ROOT })

  function authed(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    return sessions.get(token)
  }

  const server = http.createServer(async (req, res) => {
    securityHeaders(res)
    const method = req.method || 'GET'
    const url = req.url || '/'
    const path = url.split('?')[0]

    // ----- unauthenticated routes -----
    if (path === '/login' && method === 'GET') {
      if (authed(req)) { res.writeHead(302, { Location: '/' }); res.end(); return }
      const body = loginPage()
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
      return
    }

    if (path === '/api/login' && method === 'POST') {
      const ip = clientIp(req)
      if (!limiter.check(ip)) {
        res.setHeader('Retry-After', String(limiter.retryAfter(ip)))
        return sendJson(res, 429, { error: 'Too many attempts. Try again later.' })
      }
      const raw = await readBody(req)
      let creds = {}
      try { creds = JSON.parse(raw || '{}') } catch (e) {
        // fall back to urlencoded form bodies
        creds = Object.fromEntries(new URLSearchParams(raw))
      }
      const userOk = WOODSHED_USER && safeEqual(creds.user, WOODSHED_USER)
      const passOk = WOODSHED_PASS_HASH && verifyPassword(String(creds.pass || ''), WOODSHED_PASS_HASH)
      if (userOk && passOk) {
        limiter.reset(ip)
        const token = sessions.create(WOODSHED_USER)
        res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, token, { maxAge: 30 * 24 * 60 * 60 }))
        return sendJson(res, 200, { ok: true })
      }
      limiter.fail(ip)
      return sendJson(res, 401, { error: 'Wrong name or password.' })
    }

    if (path === '/api/logout' && method === 'POST') {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
      sessions.destroy(token)
      res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAge: 0 }))
      return sendJson(res, 200, { ok: true })
    }

    // ----- everything below requires a valid session -----
    if (!authed(req)) {
      if (path.startsWith('/api/')) return sendJson(res, 401, { error: 'Not authenticated.' })
      res.writeHead(302, { Location: '/login' })
      res.end()
      return
    }

    // ----- authed API: hand off to feature middleware (full-path, no prefix strip) -----
    if (path.startsWith('/api/coach')) {
      if (coachMw) return void coachMw(req, res, () => sendJson(res, 404, { error: 'Not found.' }))
      return sendJson(res, 503, { error: 'Coach feature unavailable on this server.' })
    }
    if (path.startsWith('/api/repertoire')) {
      if (repertoireMw) return void repertoireMw(req, res, () => sendJson(res, 404, { error: 'Not found.' }))
      return sendJson(res, 503, { error: 'Repertoire feature unavailable on this server.' })
    }
    if (path.startsWith('/api/tones')) {
      if (tonesMw) return void tonesMw(req, res, () => sendJson(res, 404, { error: 'Not found.' }))
      return sendJson(res, 503, { error: 'Tone Studio feature unavailable on this server.' })
    }
    if (path.startsWith('/api/gear')) {
      if (gearMw) return void gearMw(req, res, () => sendJson(res, 404, { error: 'Not found.' }))
      return sendJson(res, 503, { error: 'Gear Library feature unavailable on this server.' })
    }
    if (path.startsWith('/api/identity')) {
      if (identityMw) return void identityMw(req, res, () => sendJson(res, 404, { error: 'Not found.' }))
      return sendJson(res, 503, { error: 'My Sound feature unavailable on this server.' })
    }
    if (path.startsWith('/api/stats')) {
      if (statsMw) return void statsMw(req, res, () => sendJson(res, 404, { error: 'Not found.' }))
      return sendJson(res, 503, { error: 'Practice-stats sync unavailable on this server.' })
    }
    if (path.startsWith('/api/licks')) {
      if (licksMw) return void licksMw(req, res, () => sendJson(res, 404, { error: 'Not found.' }))
      return sendJson(res, 503, { error: 'Lick Library feature unavailable on this server.' })
    }
    if (path.startsWith('/api/sessions')) {
      if (sessionsMw) return void sessionsMw(req, res, () => sendJson(res, 404, { error: 'Not found.' }))
      return sendJson(res, 503, { error: 'Session-log feature unavailable on this server.' })
    }
    if (path.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found.' })

    // ----- authed static -----
    if (method !== 'GET' && method !== 'HEAD') { return sendJson(res, 405, { error: 'Method not allowed.' }) }

    // root → the hub
    if (path === '/' || path === '') { res.writeHead(302, { Location: '/tools/' }); res.end(); return }
    // /tools/ (or /tools) → the hub index
    if (path === '/tools' || path === '/tools/') {
      const abs = resolveStatic(DIST, 'tools/index.html')
      if (abs) return sendFile(res, abs)
      return sendJson(res, 404, { error: 'Not found.' })
    }

    // /assets/* — dist bundles OR repo runtime assets
    if (path.startsWith('/assets/')) {
      if (serveAsset(res, path)) return
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return
    }

    // live files-as-truth dirs served from the repo root (browser fetches ../student/… etc.)
    // Resolve against ROOT/<seg> as the base — NOT ROOT — so an encoded traversal in the
    // tail (e.g. /student/..%2f.env) can't climb out of the live dir into sibling repo
    // files (.env, server/*, .sessions.json). Containment is checked per-subdir, not just
    // "still inside the repo". (Escaping above ROOT was already blocked; this closes the
    // in-repo read of every file via a LIVE_DIR entry segment.)
    const seg = path.split('/')[1]
    if (LIVE_DIRS.has(seg)) {
      const base = join(ROOT, seg)
      const tail = path.slice(('/' + seg).length)   // '' or '/rest…' (still percent-encoded)
      const abs = resolveStatic(base, tail)
      if (abs) return sendFile(res, abs, { cache: 'no-store' }) // data files change → never cache
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return
    }

    // everything else from dist/ (tools/*.html, fonts/, basic-pitch-model/, favicon…)
    const abs = resolveStatic(DIST, path)
    if (abs) {
      // hashed bundles get a long cache; html/data stay revalidated
      const cache = /-[A-Za-z0-9_]{8}\.[a-z0-9]+$/.test(abs) ? 'public, max-age=31536000, immutable' : 'no-cache'
      return sendFile(res, abs, { cache })
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found')
  })

  server.listen(PORT, () => {
    console.log(`[woodshed] serving on http://localhost:${PORT}  (secure cookies: ${SECURE ? 'on' : 'OFF'})`)
    console.log(`[woodshed] coach: ${coachMw ? 'on' : 'off'} · repertoire: ${repertoireMw ? 'on' : 'off'} · api key: ${API_KEY ? 'set' : 'missing'}`)
  })

  // opportunistic session sweep
  setInterval(() => sessions.sweep(), 6 * 60 * 60 * 1000).unref()
}

main().catch((e) => { console.error('[woodshed] fatal:', e); process.exit(1) })
