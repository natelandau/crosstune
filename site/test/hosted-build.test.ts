import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Run a Workers Builds script with `pnpm` and `wrangler` shims that print their arguments. */
function run(script: string, branch: string) {
  const bin = mkdtempSync(join(tmpdir(), 'site-hosted-'))
  for (const tool of ['pnpm', 'wrangler']) {
    const shim = join(bin, tool)
    writeFileSync(shim, `#!/usr/bin/env bash\necho "${tool} $*"\n`)
    chmodSync(shim, 0o755)
  }
  try {
    const result = spawnSync(
      'bash',
      [fileURLToPath(new URL(`../scripts/${script}`, import.meta.url))],
      {
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH ?? ''}`, WORKERS_CI_BRANCH: branch },
      },
    )
    return { status: result.status, stdout: result.stdout.trim() }
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
}

describe('Workers Builds scripts', () => {
  it.each([
    ['hosted-build.sh', 'pnpm build'],
    ['deploy-preview.sh', 'wrangler preview'],
  ])('%s runs on a feature branch', (script, command) => {
    expect(run(script, 'feat/hero')).toMatchObject({ status: 0, stdout: command })
  })

  it.each(['hosted-build.sh', 'deploy-preview.sh'])(
    '%s does nothing on a Dependabot branch',
    (script) => {
      expect(run(script, 'dependabot/npm_and_yarn/site/astro-7.5.0')).toMatchObject({
        status: 0,
        stdout: '',
      })
    },
  )
})
