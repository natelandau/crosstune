// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./branch-slug.mjs', import.meta.url))

/** Run the script with only the given environment, so CI's own branch variables never leak in. */
function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('branch-slug', () => {
  it('turns a slash into a dash', () => {
    expect(run(['feat/instrument-tunings'])).toMatchObject({
      status: 0,
      stdout: 'feat-instrument-tunings\n',
    })
  })

  it('folds uppercase and underscores', () => {
    expect(run(['Feature_Branch__Two'])).toMatchObject({
      status: 0,
      stdout: 'feature-branch-two\n',
    })
  })

  it('prefixes a slug that does not start with a letter', () => {
    expect(run(['123-fix'])).toMatchObject({ status: 0, stdout: 'b-123-fix\n' })
  })

  it('trims leading and trailing separators', () => {
    expect(run(['/feat/tunings/'])).toMatchObject({ status: 0, stdout: 'feat-tunings\n' })
  })

  it('cuts a long branch to 40 characters without a trailing dash', () => {
    const branch = `${'a'.repeat(39)}-${'b'.repeat(20)}`
    expect(branch).toHaveLength(60)
    const slug = run([branch]).stdout.trim()
    expect(slug).toHaveLength(40)
    expect(slug).toMatch(/^a{33}-[0-9a-f]{6}$/)
  })

  it('keeps two branches sharing the first 40 characters apart', () => {
    const shared = 'a'.repeat(45)
    const first = run([`${shared}-one`]).stdout
    const second = run([`${shared}-two`]).stdout
    expect(first).not.toBe(second)
    expect(first.trim()).toHaveLength(40)
    expect(second.trim()).toHaveLength(40)
  })

  it('gives a branch the same slug on every run', () => {
    const branch = `feat/${'long-name-'.repeat(6)}end`
    expect(run([branch]).stdout).toBe(run([branch]).stdout)
  })

  it('leaves a branch of exactly 40 characters unhashed', () => {
    const branch = 'a'.repeat(40)
    expect(run([branch])).toMatchObject({ status: 0, stdout: `${branch}\n` })
  })

  it('reads WORKERS_CI_BRANCH before GITHUB_HEAD_REF', () => {
    expect(
      run([], { WORKERS_CI_BRANCH: 'from/workers', GITHUB_HEAD_REF: 'from/github' }),
    ).toMatchObject({ status: 0, stdout: 'from-workers\n' })
  })

  it('reads GITHUB_HEAD_REF when nothing else is set', () => {
    expect(run([], { GITHUB_HEAD_REF: 'from/github' })).toMatchObject({
      status: 0,
      stdout: 'from-github\n',
    })
  })

  it('prefers the argument over the environment', () => {
    expect(run(['from/arg'], { WORKERS_CI_BRANCH: 'from/workers' })).toMatchObject({
      status: 0,
      stdout: 'from-arg\n',
    })
  })

  it('exits non-zero when no branch is found', () => {
    const result = run([])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/no branch/)
  })
})
