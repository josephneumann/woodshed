#!/usr/bin/env node
// Print a scrypt password hash for WOODSHED_PASS_HASH in your .env.
//
//   node scripts/hash-password.js 'my secret password'
//   npm run hash-pass 'my secret password'
//
// Copy the printed line (the whole scrypt:... string) into .env as:
//   WOODSHED_PASS_HASH=scrypt:...
// The plaintext is never stored — only this hash goes to disk.

import { hashPassword } from '../server/auth.js'

const pw = process.argv[2]
if (!pw) {
  console.error("usage: node scripts/hash-password.js 'your password'")
  console.error('(quote the password so the shell keeps spaces/symbols intact)')
  process.exit(1)
}

const hash = hashPassword(pw)
console.log('\nAdd this line to your .env:\n')
console.log('WOODSHED_PASS_HASH=' + hash)
console.log('')
