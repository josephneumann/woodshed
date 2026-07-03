// Auth for the standalone Woodshed server — single user, personal data, pragmatic
// hardening with zero framework deps (node:crypto only).
//
// Exports:
//   hashPassword(pw)            -> 'scrypt:N:r:p:salthex:hashhex'
//   verifyPassword(pw, stored)  -> boolean (timing-safe)
//   Sessions(opts)              -> a token session store (Map + .sessions.json)
//   parseCookies(header)        -> { name: value }
//   cookie(name, value, opts)   -> a Set-Cookie header string
//   rateLimiter(opts)           -> { check(ip), fail(ip), reset(ip) }
//
// The session store persists to .sessions.json so a server restart keeps you logged
// in. Tokens are 32 random bytes; sessions roll their expiry forward on use (30 days).

import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------- password hashing (scrypt) ----------
// scrypt params: N (cost) must be a power of two. r=8, p=1 are standard. maxmem is
// bumped so the default 32MB ceiling doesn't reject N=16384 (~16MB) with headroom.
const SCRYPT_N = 16384
const SCRYPT_r = 8
const SCRYPT_p = 1
const KEYLEN = 32
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_r * 2 // generous ceiling

function scryptHash(pw, saltBuf, N, r, p) {
  return scryptSync(Buffer.from(String(pw), 'utf8'), saltBuf, KEYLEN, {
    N, r, p, maxmem: 128 * N * r * 2,
  })
}

export function hashPassword(pw) {
  if (typeof pw !== 'string' || !pw.length) throw new Error('password required')
  const salt = randomBytes(16)
  const hash = scryptHash(pw, salt, SCRYPT_N, SCRYPT_r, SCRYPT_p)
  return `scrypt:${SCRYPT_N}:${SCRYPT_r}:${SCRYPT_p}:${salt.toString('hex')}:${hash.toString('hex')}`
}

// Constant-time verify. Any malformed stored string returns false without throwing.
export function verifyPassword(pw, stored) {
  try {
    if (typeof pw !== 'string' || typeof stored !== 'string') return false
    const parts = stored.split(':')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const N = parseInt(parts[1], 10)
    const r = parseInt(parts[2], 10)
    const p = parseInt(parts[3], 10)
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false
    const salt = Buffer.from(parts[4], 'hex')
    const expected = Buffer.from(parts[5], 'hex')
    if (!salt.length || expected.length !== KEYLEN) return false
    const got = scryptHash(pw, salt, N, r, p)
    if (got.length !== expected.length) return false
    return timingSafeEqual(got, expected)
  } catch (e) {
    return false
  }
}

// Timing-safe string compare for the username (avoid leaking user existence via timing).
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a), 'utf8')
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8')
  // Hash both to a fixed width so length never short-circuits the compare.
  const ha = createHash('sha256').update(ba).digest()
  const hb = createHash('sha256').update(bb).digest()
  return timingSafeEqual(ha, hb)
}

// ---------- cookie helpers ----------
export function parseCookies(header) {
  const out = {}
  if (!header || typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

// Build a Set-Cookie header string. secure defaults on unless WOODSHED_SECURE==='0'.
export function cookie(name, value, opts = {}) {
  const secure = opts.secure !== false && process.env.WOODSHED_SECURE !== '0'
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push('Path=/')
  parts.push('HttpOnly')
  parts.push('SameSite=Lax')
  if (secure) parts.push('Secure')
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`)
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`)
  return parts.join('; ')
}

// ---------- session store ----------
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, rolling
export const SESSION_COOKIE = 'woodshed_sid'

export class Sessions {
  constructor(opts = {}) {
    this.file = resolve(opts.root || process.cwd(), '.sessions.json')
    this.ttl = opts.ttl || SESSION_TTL_MS
    this.map = new Map() // token -> { user, expires }
    this._load()
  }

  _load() {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'))
      const now = Date.now()
      for (const s of data.sessions || []) {
        if (s && s.token && s.expires > now) this.map.set(s.token, { user: s.user, expires: s.expires })
      }
    } catch (e) { /* no store yet — fine */ }
  }

  _persist() {
    try {
      const now = Date.now()
      const sessions = []
      for (const [token, s] of this.map) if (s.expires > now) sessions.push({ token, user: s.user, expires: s.expires })
      writeFileSync(this.file, JSON.stringify({ version: 1, sessions }, null, 2))
    } catch (e) { /* non-fatal: sessions still live in memory */ }
  }

  create(user) {
    const token = randomBytes(32).toString('hex')
    this.map.set(token, { user, expires: Date.now() + this.ttl })
    this._persist()
    return token
  }

  // Return the session and roll its expiry forward if valid; else null.
  get(token) {
    if (!token) return null
    const s = this.map.get(token)
    if (!s) return null
    if (s.expires <= Date.now()) { this.map.delete(token); this._persist(); return null }
    // rolling window: refresh expiry, persist lazily (only when >1h drift to limit writes)
    const next = Date.now() + this.ttl
    if (next - s.expires > 60 * 60 * 1000) { s.expires = next; this._persist() }
    return s
  }

  destroy(token) {
    if (token && this.map.delete(token)) this._persist()
  }

  // Drop expired entries (called opportunistically).
  sweep() {
    const now = Date.now()
    let dirty = false
    for (const [t, s] of this.map) if (s.expires <= now) { this.map.delete(t); dirty = true }
    if (dirty) this._persist()
  }
}

// ---------- login rate limiter ----------
// 5 failures per window (15 min) per IP, then 429 until the window rolls off.
export function rateLimiter(opts = {}) {
  const max = opts.max || 5
  const windowMs = opts.windowMs || 15 * 60 * 1000
  const hits = new Map() // ip -> { count, first }

  function prune(now) {
    for (const [ip, h] of hits) if (now - h.first > windowMs) hits.delete(ip)
  }

  return {
    // true if the IP is allowed to attempt a login right now.
    check(ip) {
      const now = Date.now()
      prune(now)
      const h = hits.get(ip)
      if (!h) return true
      if (now - h.first > windowMs) { hits.delete(ip); return true }
      return h.count < max
    },
    // record a failed attempt.
    fail(ip) {
      const now = Date.now()
      const h = hits.get(ip)
      if (!h || now - h.first > windowMs) hits.set(ip, { count: 1, first: now })
      else h.count++
    },
    // clear on success.
    reset(ip) { hits.delete(ip) },
    // seconds until the window rolls off for this IP (for Retry-After).
    retryAfter(ip) {
      const h = hits.get(ip)
      if (!h) return 0
      return Math.max(1, Math.ceil((windowMs - (Date.now() - h.first)) / 1000))
    },
  }
}
