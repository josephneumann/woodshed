import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'node:path'
import { readdirSync, copyFileSync, mkdirSync } from 'node:fs'
import coachPlugin from './server/coach-plugin.js'
import repertoirePlugin from './server/repertoire-plugin.js'
import tonesPlugin from './server/tones-plugin.js'
import gearPlugin from './server/gear-plugin.js'
import identityPlugin from './server/identity-plugin.js'
import statsPlugin from './server/stats-plugin.js'
import licksPlugin from './server/licks-plugin.js'
import sessionsPlugin from './server/sessions-plugin.js'

// The shared layer is CLASSIC scripts referenced by <script src> (by design — see
// theory.js header). Vite leaves those references untouched and does NOT copy the
// files, so a production build must carry them over verbatim. coach.js is also
// loaded dynamically by header.js at runtime, invisible to the bundler.
const CLASSIC_SCRIPTS = ['theory.js', 'audio.js', 'stats.js', 'header.js', 'coach.js', 'pitch.js', 'mic.js']
function copyClassicScripts(root) {
  return {
    name: 'woodshed-copy-classic-scripts',
    apply: 'build',
    closeBundle() {
      const out = resolve(root, 'dist', 'tools')
      mkdirSync(out, { recursive: true })
      for (const f of CLASSIC_SCRIPTS) copyFileSync(resolve(root, 'tools', f), resolve(out, f))
    },
  }
}

// Project root is the web root (tools/ fetch ../student/*.json, ../reference/*.json, etc.),
// so we serve the whole repo and treat each tools/*.html as a multi-page entry point.
const root = import.meta.dirname
const toolPages = Object.fromEntries(
  readdirSync(resolve(root, 'tools'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(root, 'tools', f)]),
)

export default defineConfig(({ mode }) => {
  // Read .env (all keys, no VITE_ prefix filter) so ANTHROPIC_API_KEY stays server-side.
  const env = loadEnv(mode, root, '')
  return {
    appType: 'mpa', // multi-page: no SPA history fallback
    plugins: [coachPlugin({ apiKey: env.ANTHROPIC_API_KEY, root }), repertoirePlugin({ root }), tonesPlugin({ root }), gearPlugin({ root }), identityPlugin({ root }), statsPlugin({ root }), licksPlugin({ root }), sessionsPlugin({ root }), copyClassicScripts(root)],
    server: {
      port: Number(process.env.PORT) || 5173,
      strictPort: !process.env.PORT, // pinned to 5173 by default; preview/CI can override via PORT
    },
    build: {
      rollupOptions: {
        // analyze.js is dynamically imported by coach.js (a classic script the
        // bundler can't see through), so emit it as a stable-named ESM entry —
        // its heavy deps (Basic Pitch / TF.js) become ordinary hashed chunks.
        input: { ...toolPages, analyze: resolve(root, 'tools', 'analyze.js') },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'analyze' ? 'tools/analyze.js' : 'assets/[name]-[hash].js'),
        },
      },
      outDir: 'dist',
    },
  }
})
