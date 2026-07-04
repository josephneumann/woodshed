#!/usr/bin/env node
// sync-data — keep your PERSONAL practice data in a private repo, in sync across
// machines, WITHOUT ever mixing it into the public app repo.
//
// How it works: a second git repo lives in the same folder as the app, using its
// own hidden git dir (.datagit) and tracking ONLY your personal paths (student/,
// curriculum/, Resources/, your reference notes). The public repo gitignores those
// paths; this private repo owns them. No symlinks; identical on Windows and macOS.
//
//   node scripts/sync-data.mjs init            first machine: create it locally
//   node scripts/sync-data.mjs link <git-url>  point it at your private GitHub repo
//   node scripts/sync-data.mjs save ["msg"]    stage + commit + push your data
//   node scripts/sync-data.mjs clone <git-url> NEW machine: pull your data down
//   node scripts/sync-data.mjs load            later: pull the latest data
//   node scripts/sync-data.mjs status          what's changed
//   node scripts/sync-data.mjs git <args...>   run any git command on the data repo
//
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GIT_DIR = join(ROOT, '.datagit')

// The personal paths this private repo owns — must match the public repo's
// .gitignore private set. Directories are added whole; individual files listed.
const MANIFEST = [
  'student',
  'curriculum',
  'Resources',
  'reference/paul-davids-next-level-playing.md',
  'reference/justinguitar-guitar-grades.md',
  'reference/justinguitar-practical-music-theory.md',
  'reference/andrew-clarke-connected-guitar.md',
  'reference/supplementary-resources.md',
  'reference/resource-library.json',
]
const IDENTITY_NAME = 'josephneumann'
const IDENTITY_EMAIL = '14467042+josephneumann@users.noreply.github.com'

// every data-repo git call is git-dir=.datagit, work-tree=ROOT
function git(args, opts = {}) {
  const out = execFileSync('git', ['--git-dir=' + GIT_DIR, '--work-tree=' + ROOT, ...args],
    { cwd: ROOT, stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', ...opts })
  return out == null ? '' : String(out).trim()
}
function tryGit(args) { try { return git(args, { capture: true }) } catch { return null } }
const present = () => MANIFEST.filter(p => existsSync(join(ROOT, p)))
const hasRepo = () => existsSync(GIT_DIR)
const hasOrigin = () => !!tryGit(['remote', 'get-url', 'origin'])

function configure() {
  git(['config', 'status.showUntrackedFiles', 'no'])   // don't list the whole app as "untracked"
  git(['config', 'user.name', IDENTITY_NAME])
  git(['config', 'user.email', IDENTITY_EMAIL])
  git(['config', 'core.autocrlf', 'false'])            // keep files byte-identical across OSes
}
function stage() { const p = present(); if (p.length) git(['add', '-f', '--', ...p]) }

function guardGitignore() {
  // make sure the public repo never tracks the private git dir
  const gi = join(ROOT, '.gitignore')
  try {
    const txt = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
    if (!/^\.datagit\/?$/m.test(txt)) console.log('  note: add ".datagit/" to .gitignore so the public repo ignores it.')
  } catch {}
}
guardGitignore()

const [cmd, ...rest] = process.argv.slice(2)

switch (cmd) {
  case 'init': {
    if (hasRepo()) { console.error('Already initialized (.datagit exists). Use "save" to commit, or "status".'); process.exit(1) }
    git(['init', '-b', 'main'])
    configure()
    stage()
    git(['commit', '-m', 'woodshed personal data'])
    console.log('\n✓ Private data repo created locally, tracking:', present().join(', '))
    console.log('\nNext:')
    console.log('  1. Create a PRIVATE repo on GitHub (empty, no README): https://github.com/new')
    console.log('  2. node scripts/sync-data.mjs link https://github.com/<you>/woodshed-data.git')
    console.log('  3. node scripts/sync-data.mjs save')
    break
  }
  case 'link': {
    const url = rest[0]
    if (!url) { console.error('Usage: sync-data link <git-url>'); process.exit(1) }
    if (!hasRepo()) { console.error('Run "init" first.'); process.exit(1) }
    if (hasOrigin()) git(['remote', 'set-url', 'origin', url]); else git(['remote', 'add', 'origin', url])
    console.log('✓ Linked to', url, '\n  Now: node scripts/sync-data.mjs save')
    break
  }
  case 'save': {
    if (!hasRepo()) { console.error('Run "init" first.'); process.exit(1) }
    stage()
    const dirty = tryGit(['status', '--porcelain'])
    if (dirty) git(['commit', '-m', rest.join(' ') || ('data update ' + new Date().toISOString().slice(0, 16).replace('T', ' '))])
    else console.log('Nothing changed since the last save.')
    if (hasOrigin()) { git(['push', '-u', 'origin', 'main']); console.log('✓ Pushed to your private repo.') }
    else console.log('  (no remote yet — run "link <git-url>" then "save" again to push)')
    break
  }
  case 'clone': {
    // NEW machine: the app is already cloned + npm-installed (blank seeds in place).
    // Overlay the real data on top, overwriting the blanks.
    const url = rest[0]
    if (!url) { console.error('Usage: sync-data clone <git-url>'); process.exit(1) }
    if (hasRepo()) { console.error('.datagit already exists here — use "load" to pull instead.'); process.exit(1) }
    git(['init', '-b', 'main'])
    configure()
    git(['remote', 'add', 'origin', url])
    git(['fetch', 'origin'])
    git(['reset', '--hard', 'origin/main'])            // brings your real data in over the seeds
    git(['branch', '--set-upstream-to=origin/main', 'main'])
    console.log('✓ Your personal data is now here:', present().join(', '))
    break
  }
  case 'load': {
    if (!hasRepo()) { console.error('No data repo here. On a new machine run "clone <git-url>" instead.'); process.exit(1) }
    if (!hasOrigin()) { console.error('No remote linked. Run "link <git-url>" first.'); process.exit(1) }
    git(['fetch', 'origin'])
    git(['merge', '--ff-only', 'origin/main'])
    console.log('✓ Pulled the latest data.')
    break
  }
  case 'status': {
    if (!hasRepo()) { console.error('No data repo yet. Run "init".'); process.exit(1) }
    console.log('Tracking:', present().join(', '), '\n')
    git(['status', '-sb'])
    break
  }
  case 'git': {
    if (!hasRepo()) { console.error('No data repo yet. Run "init".'); process.exit(1) }
    git(rest)
    break
  }
  default:
    console.log(`sync-data — your personal practice data, synced privately across machines.

  node scripts/sync-data.mjs init            first machine: create the private data repo locally
  node scripts/sync-data.mjs link <git-url>  point it at your private GitHub repo
  node scripts/sync-data.mjs save ["msg"]    commit + push your latest data
  node scripts/sync-data.mjs clone <git-url> a NEW machine: pull your data down over the blanks
  node scripts/sync-data.mjs load            pull the latest changes
  node scripts/sync-data.mjs status          show what's changed
  node scripts/sync-data.mjs git <args...>   run any git command against the data repo

Tracks: ${MANIFEST.join(', ')}`)
}
