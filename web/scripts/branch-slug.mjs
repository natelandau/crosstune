#!/usr/bin/env node
// Prints the preview alias for a branch. Workers Builds passes it to
// `wrangler versions upload --preview-alias`, and the preview workflow keys the
// KV entry with it, so both must agree on the same rule.

const MAX_LENGTH = 40

/** @param {string} branch */
function slugify(branch) {
  let slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // A DNS label must start with a letter for the alias to be a valid hostname prefix.
  if (!/^[a-z]/.test(slug)) slug = `b-${slug}`
  return slug.slice(0, MAX_LENGTH).replace(/-+$/, '')
}

const branch = process.argv[2] || process.env.WORKERS_CI_BRANCH || process.env.GITHUB_HEAD_REF
if (!branch) {
  console.error(
    'branch-slug: no branch given and neither WORKERS_CI_BRANCH nor GITHUB_HEAD_REF is set',
  )
  process.exit(1)
}
process.stdout.write(`${slugify(branch)}\n`)
