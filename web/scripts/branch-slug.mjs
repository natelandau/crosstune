#!/usr/bin/env node
// Prints the Preview name for a branch. Workers Builds passes it to
// `wrangler preview --name`, and the preview workflow keys the KV entry with
// it, so both must agree on the same rule.

import { createHash } from 'node:crypto'

const MAX_LENGTH = 40
// 64 bits, so no one can search for a branch name whose hash matches another's.
const HASH_LENGTH = 16
const HASHED = new RegExp(`-[0-9a-f]{${HASH_LENGTH}}$`)

/** @param {string} branch */
function slugify(branch) {
  let slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // A DNS label must start with a letter for the name to be a valid hostname prefix.
  if (!/^[a-z]/.test(slug)) slug = `b-${slug}`
  // A clean name that ends like a hash is hashed too, so a branch cannot be named
  // after another branch's hashed slug.
  if (slug === branch && slug.length <= MAX_LENGTH && !HASHED.test(slug)) return slug
  // The name keys the KV entry that points a preview at its own API, so two
  // branches that normalize or cut to the same slug would share one preview and
  // one API origin. A hash of the exact branch name keeps every slug unique.
  const hash = createHash('sha256').update(branch).digest('hex').slice(0, HASH_LENGTH)
  const head = slug.slice(0, MAX_LENGTH - HASH_LENGTH - 1).replace(/-+$/, '')
  return `${head}-${hash}`
}

const branch = process.argv[2] || process.env.WORKERS_CI_BRANCH || process.env.GITHUB_HEAD_REF
if (!branch) {
  console.error(
    'branch-slug: no branch given and neither WORKERS_CI_BRANCH nor GITHUB_HEAD_REF is set',
  )
  process.exit(1)
}
process.stdout.write(`${slugify(branch)}\n`)
