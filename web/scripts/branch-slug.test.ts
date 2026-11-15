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
  it.each(['fix-thing', 'feat-instrument-tunings', 'a'.repeat(40)])(
    'keeps the clean name %s as it is',
    (branch) => {
      expect(run([branch])).toMatchObject({ status: 0, stdout: `${branch}\n` })
    },
  )

  it.each([
    ['feat/instrument-tunings', /^feat-instrument-tunings-[0-9a-f]{6}$/],
    ['Feature_Branch__Two', /^feature-branch-two-[0-9a-f]{6}$/],
    ['123-fix', /^b-123-fix-[0-9a-f]{6}$/],
    ['/feat/tunings/', /^feat-tunings-[0-9a-f]{6}$/],
  ])('normalizes %s and adds a hash of the exact name', (branch, expected) => {
    const result = run([branch])
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toMatch(expected)
  })

  it.each([
    ['a_b', 'a-b'],
    ['A-b', 'a-b'],
    ['a/b', 'a_b'],
    ['a--b', 'a-b'],
    [`${'a'.repeat(45)}-one`, `${'a'.repeat(45)}-two`],
  ])('gives %s and %s different slugs', (first, second) => {
    expect(run([first]).stdout).not.toBe(run([second]).stdout)
  })

  it('cuts a long branch to 40 characters without a trailing dash', () => {
    const branch = `${'a'.repeat(39)}-${'b'.repeat(20)}`
    expect(branch).toHaveLength(60)
    const slug = run([branch]).stdout.trim()
    expect(slug).toHaveLength(40)
    expect(slug).toMatch(/^a{33}-[0-9a-f]{6}$/)
  })

  it('gives a branch the same slug on every run', () => {
    const branch = `feat/${'long-name-'.repeat(6)}end`
    expect(run([branch]).stdout).toBe(run([branch]).stdout)
  })

  it('reads WORKERS_CI_BRANCH before GITHUB_HEAD_REF', () => {
    expect(
      run([], { WORKERS_CI_BRANCH: 'from-workers', GITHUB_HEAD_REF: 'from-github' }),
    ).toMatchObject({ status: 0, stdout: 'from-workers\n' })
  })

  it('reads GITHUB_HEAD_REF when nothing else is set', () => {
    expect(run([], { GITHUB_HEAD_REF: 'from-github' })).toMatchObject({
      status: 0,
      stdout: 'from-github\n',
    })
  })

  it('prefers the argument over the environment', () => {
    expect(run(['from-arg'], { WORKERS_CI_BRANCH: 'from-workers' })).toMatchObject({
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
