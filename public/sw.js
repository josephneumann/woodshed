// The Woodshed service worker — offline shell for the practice room.
//
// Strategy (deliberately conservative — the app is local-first and data-live):
//   · same-origin GET statics (html/css/js/fonts/images/wasm) → stale-while-revalidate
//   · /api/*, student/*, anything non-GET, SSE → network ONLY, never cached
//     (practice data must never be stale; the coach stream must never be intercepted)
// Bump CACHE_V to invalidate everything after a big release.
const CACHE_V = 'woodshed-v1'

self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

const NEVER_CACHE = /\/api\/|\/student\/|\/sessions\b/

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (NEVER_CACHE.test(url.pathname)) return // straight to network, no interception

  // stale-while-revalidate: serve cache fast, refresh in the background
  e.respondWith(
    caches.open(CACHE_V).then(async (cache) => {
      const cached = await cache.match(req)
      const refresh = fetch(req).then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) cache.put(req, res.clone())
        return res
      }).catch(() => cached) // offline: fall back to whatever we have
      return cached || refresh
    })
  )
})
