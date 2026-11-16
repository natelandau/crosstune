// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./deploy-preview.sh', import.meta.url))
const WEB = fileURLToPath(new URL('..', import.meta.url))

/** Run the script with a `wrangler` shim first on PATH that prints its arguments. */
function run(branch: string) {
  const bin = mkdtempSync(join(tmpdir(), 'deploy-preview-'))
  const shim = join(bin, 'wrangler')
  writeFileSync(shim, '#!/usr/bin/env bash\necho "$*"\n')
  chmodSync(shim, 0o755)
  try {
    const result = spawnSync('bash', [SCRIPT], {
      cwd: WEB,
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH ?? ''}`, WORKERS_CI_BRANCH: branch },
    })
    return { status: result.status, stdout: result.stdout.trim() }
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
}

describe('deploy-preview', () => {
  it('names the Preview with the branch slug', () => {
    expect(run('feat/tunings')).toMatchObject({
      status: 0,
      stdout: expect.stringMatching(/^preview --name feat-tunings-[0-9a-f]{16}$/),
    })
  })

  it('uploads nothing on a Dependabot branch', () => {
    expect(run('dependabot/npm_and_yarn/web/vite-7.1.0')).toMatchObject({ status: 0, stdout: '' })
  })
})
