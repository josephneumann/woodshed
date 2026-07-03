# DEPLOY — getting The Woodshed off localhost

> How the standalone server runs, where it should live, and why. Companion to
> `server/serve.js` (the server), `server/auth.js` (login), `.env.example` (config).

`npm run build && npm start` serves the whole app — built tools, live `student/`
files, and the embedded Instructor — on one port (`PORT`, default 8787), everything
behind a username + password. Point Caddy at it and you have HTTPS.

---

## The decision: files-as-truth on a small VPS

**Recommendation: run the persistent Node server on a cheap VPS (Hetzner CX22 or
similar), files-as-truth on disk, behind Caddy.** This is not the trendy answer
(that would be Vercel + a managed Postgres). It is the right answer for *this* app,
for these reasons:

1. **`student/` files ARE the database — and the bridge to the other coach.**
   Claude Code's `/instructor` skill reads and writes the exact same
   `student/*.md` + `*.json` files the embedded web coach does
   (`server/coach-plugin.js` reads `student/`, `curriculum/`, `reference/` and writes
   `student/`). That two-coach symbiosis — a human-driven Claude Code session and the
   in-app coach sharing one ground truth — only works because the truth is *plain
   files on a disk both can reach*. Move the app's data into Postgres and you either
   break `/instructor` or build a sync layer to keep DB and files in lockstep. That
   machinery buys nothing at single-user scale.

2. **Single user, personal data.** There is no multi-tenant story, no concurrent-writer
   contention, no need for a query planner. One person, one guitar, a few megabytes of
   markdown and JSON. A relational database is a solution to problems we do not have.

3. **SSE + long coach turns want a persistent process.** `/api/coach` streams a
   Sonnet/Opus turn over Server-Sent Events, and an agentic tool loop can run for
   tens of seconds (web_search, file reads/writes, multiple model round-trips). A
   long-lived Node process handles this natively. Serverless functions fight it:
   duration caps, cold starts mid-stream, and no clean way to hold an SSE connection
   open across a tool loop.

4. **Recordings need a disk.** Take audio and the transcription pipeline assume a
   real filesystem. Blob storage is a swap you *can* make, but on one machine the
   disk is simpler and free.

The VPS keeps the whole model — local-first, own-your-data, files-as-truth — intact
while making it reachable from a phone or a friend's browser.

---

## Zero-host option: Tailscale on the home machine

If you don't want anything public at all, you don't need a VPS. Run
`npm run build && npm start` on the machine that already lives in `student/`
(your desktop), install [Tailscale](https://tailscale.com/) on it and on your phone
and Mac, and reach `http://<machine-name>:8787` over the tailnet.

- No public exposure, no open ports, no attack surface beyond your own devices.
- No TLS to manage (tailnet traffic is encrypted end to end). You can set
  `WOODSHED_SECURE=0` since there's no HTTPS — **but keep the login anyway**: it's one
  more layer and costs nothing, and it stops a housemate on the same tailnet from
  wandering into your practice log.
- Tradeoff: the home machine has to be awake and running the process. A `pm2` or a
  user-level systemd/launchd service covers that.

This is the lowest-friction path and a fine permanent home. The VPS runbook below is
for when you want a stable URL that doesn't depend on your desktop being on.

---

## The Vercel + Postgres path (documented, NOT built)

Fully doable later; here's the honest swap list so the decision stays reversible.
The point of writing it down is to show it buys nothing at N=1 — not to hedge.

| Today (files-as-truth) | Would become | Work required |
|---|---|---|
| `coach-plugin.js` / `repertoire-plugin.js` read & write files directly | A `DataLayer` interface those plugins call instead | Extract every `readFileSync`/`writeFileSync` under `student/`, `reference/` behind an async interface with a `files` impl (kept for local) and a `db` impl |
| `student/PROGRESS-LOG.md`, `current-plan.json`, `progress-data.json`, `gear.json`, `REPERTOIRE.md` | Postgres rows/JSONB | Schema + migrations; markdown logs become a `log_entries` table or a single JSONB doc |
| `coach-history.json` / `coach-archive.json` | `messages` table | Straightforward; already append-mostly |
| `coach-memory.md` | `memory` row/table | Trivial |
| Take audio (IndexedDB / disk) | Blob storage (Vercel Blob, S3) | Upload on save; signed URLs on read |
| `.sessions.json` | KV (Vercel KV / Redis) | `Sessions` class already isolates this — swap the persist/load |
| Long SSE coach turns | Edge/serverless streaming | Fight function duration limits; the multi-round tool loop may exceed them — likely needs a separate always-on worker anyway |
| `/instructor` (Claude Code) sharing the files | A DB client, or a file<->DB sync job | This is the real cost: you either teach the skill to talk to Postgres or you run sync machinery. Two sources of truth. |

**Verdict:** the migration is mechanical except for the last row, which is the whole
reason files-as-truth exists. Do it only if the app ever goes multi-user. At N=1 it
adds moving parts and removes the two-coach symbiosis in exchange for nothing.

---

## Hetzner runbook

Assumes Ubuntu 22.04/24.04 on a fresh CX22, a domain pointed at the box, and a
non-root sudo user (`joe`).

### 1. Install Node 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v20.x+
```

### 2. Clone and configure

```bash
cd ~
git clone <your-repo-url> woodshed
cd woodshed
cp .env.example .env
npm run hash-pass 'your real password'   # prints WOODSHED_PASS_HASH=scrypt:...
nano .env                                 # paste the hash, add ANTHROPIC_API_KEY, set WOODSHED_USER
```

Keep `WOODSHED_SECURE=1` (Caddy gives you HTTPS). Set `PORT=8787`.

### 3. Build and smoke-test

```bash
npm ci
npm run build
npm start        # should log: serving on http://localhost:8787
```

`curl -I http://localhost:8787/` should 302 to `/login`. Ctrl-C once happy.

### 4. systemd unit

`/etc/systemd/system/woodshed.service`:

```ini
[Unit]
Description=The Woodshed
After=network.target

[Service]
Type=simple
User=joe
WorkingDirectory=/home/joe/woodshed
ExecStart=/usr/bin/node server/serve.js
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
# .env is read by the server itself; no EnvironmentFile needed.

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now woodshed
sudo systemctl status woodshed
journalctl -u woodshed -f       # tail logs
```

### 5. Caddy (automatic HTTPS)

Install Caddy, then `/etc/caddy/Caddyfile`:

```caddy
woodshed.example.com {
    reverse_proxy localhost:8787
}
```

```bash
sudo systemctl reload caddy
```

Caddy provisions and renews a Let's Encrypt cert automatically and forwards the real
client IP as `X-Forwarded-For` (the server reads it for rate limiting).

### 6. Firewall

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 443/tcp    # HTTPS (Caddy)
sudo ufw allow 80/tcp     # HTTP — Caddy needs it for the ACME challenge + redirect
sudo ufw enable
```

Port 8787 stays closed to the world; only Caddy on localhost reaches it.

### 7. Backups

The data lives in `student/` (and `reference/resource-library.json`). Note that
`coach-history.json`, `coach-archive.json`, and any recordings are **gitignored**, so
a git remote alone is NOT a complete backup — a tarball is the honest option:

```bash
# nightly cron: tar the whole student/ tree (includes the gitignored history)
0 3 * * *  tar czf ~/backups/woodshed-$(date +\%F).tgz -C ~/woodshed student reference/resource-library.json
```

Rotate with `find ~/backups -name 'woodshed-*.tgz' -mtime +30 -delete`. Copy off-box
(rsync/scp/S3) if the VPS itself is a single point of failure. A private git remote
covers the version-controlled files and is a fine *secondary* — just not the complete
one.

### 8. Updating

```bash
cd ~/woodshed
git pull
npm ci
npm run build
sudo systemctl restart woodshed
```

Sessions survive the restart (`.sessions.json` is reloaded), so you stay logged in.

---

## Security checklist

**Implemented in this server:**

- **scrypt password hashing** (`server/auth.js`), salted, params encoded in the stored
  string. Plaintext is never written anywhere.
- **Timing-safe compares** for both password (`timingSafeEqual` on the derived key)
  and username (hashed then compared, so length/content don't leak via timing).
- **HttpOnly + SameSite=Lax + Secure cookies** — not readable by JS, not sent
  cross-site, HTTPS-only when `WOODSHED_SECURE=1`.
- **Session tokens** are 32 bytes of `crypto.randomBytes`, stored server-side; the
  cookie carries only the opaque token. 30-day rolling expiry.
- **Login rate limit**: 5 failures / 15 min per IP → HTTP 429 with `Retry-After`.
- **Traversal-proof static + file serving**: every path is decoded, normalized, and
  confirmed to resolve *inside* its base dir; null bytes rejected; no directory
  listings. The coach's file tools are independently sandboxed to `student/`,
  `curriculum/`, `reference/` (see `AGENT-INTERFACE.md`).
- **API key server-side only** — read from `.env`, handed to the coach middleware,
  never emitted to the client.
- **Security headers** on every response: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, and HSTS when secure.
- **Auth gate is default-deny**: everything except `/login` and the login/logout API
  requires a valid session — API paths get a 401 JSON, pages get a 302 to `/login`.

**Keep in mind (operational):**

- **HTTPS only, via Caddy.** The `Secure` cookie flag means a plain-HTTP deployment
  will silently fail to keep you logged in. Never expose the raw `:8787` port.
- **The API key is money.** It's in `.env`, which is gitignored — keep it that way.
  Rotate it in the Anthropic console at the first sign of trouble.
- **Rotate on suspicion.** If a session might be compromised, delete `.sessions.json`
  and restart — every token is invalidated and you log in fresh.
- **One user by design.** This is not a multi-account system. Don't hand the login to
  someone you wouldn't hand your practice journal.
