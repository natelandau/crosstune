// The installed @clerk/clerk-js version, which the site loads from Clerk's own script host. The
// package's exports hide its package.json, so it is read from disk.
import { readFileSync } from 'node:fs'

export const CLERK_JS_VERSION = JSON.parse(
  readFileSync(new URL('./node_modules/@clerk/clerk-js/package.json', import.meta.url), 'utf8'),
).version
