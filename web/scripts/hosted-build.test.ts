// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./hosted-build.sh', import.meta.url))

/** Run the script with a `pnpm` shim first on PATH that prints what a build would see. */
function run(env: Record<string, string>) {
  const bin = mkdtempSync(join(tmpdir(), 'hosted-build-'))
  const shim = join(bin, 'pnpm')
  writeFileSync(
    shim,
    '#!/usr/bin/env bash\necho "$1 $VITE_CLERK_PUBLISHABLE_KEY $VITE_SENTRY_ENVIRONMENT $VITE_SENTRY_DSN"\n',
  )
  chmodSync(shim, 0o755)
  try {
    const result = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        CLERK_PUBLISHABLE_KEY_PRODUCTION: 'pk_live_x',
        CLERK_PUBLISHABLE_KEY_DEVELOPMENT: 'pk_test_x',
        VITE_SENTRY_DSN: 'https://dsn.example',
        ...env,
      },
    })
    return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr }
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
}

describe('hosted-build', () => {
  it('builds production with the production key and environment', () => {
    expect(run({ WORKERS_CI_BRANCH: 'production' })).toMatchObject({
      status: 0,
      stdout: 'build pk_live_x production https://dsn.example',
    })
  })

  it.each(['main', 'feat/tunings'])(
    'builds %s with the development key and environment',
    (branch) => {
      expect(run({ WORKERS_CI_BRANCH: branch })).toMatchObject({
        status: 0,
        stdout: 'build pk_test_x development https://dsn.example',
      })
    },
  )

  it('fails when the branch is unknown', () => {
    const result = run({})
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/WORKERS_CI_BRANCH/)
  })

  it('fails when the chosen key is missing', () => {
    const result = run({ WORKERS_CI_BRANCH: 'production', CLERK_PUBLISHABLE_KEY_PRODUCTION: '' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/CLERK_PUBLISHABLE_KEY_PRODUCTION/)
  })
})
