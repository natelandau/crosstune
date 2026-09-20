#!/usr/bin/env node
// Prints the preview alias for a branch. Workers Builds passes it to
// `wrangler versions upload --preview-alias`, and the preview workflow keys the
// KV entry with it, so both must agree on the same rule.

import { createHash } from 'node:crypto'

const MAX_LENGTH = 40
const HASH_LENGTH = 6

/** @param {string} branch */
function slugify(branch) {
  let slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // A DNS label must start with a letter for the alias to be a valid hostname prefix.
  if (!/^[a-z]/.test(slug)) slug = `b-${slug}`
  if (slug.length <= MAX_LENGTH) return slug
  // The alias keys the KV entry that points a preview at its own API, so two
  // branches cut to the same slug would share one preview and one API origin.
  // A hash of the whole branch name keeps a cut slug unique.
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
