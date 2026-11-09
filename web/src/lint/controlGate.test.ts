// @vitest-environment node
import { ESLint } from 'eslint'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { controlAllowlist } from '../../eslint/controlAllowlist.js'

const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const eslint = new ESLint({ cwd: webRoot })

const lint = async (source: string, filePath: string) => {
  const results = await eslint.lintText(source, { filePath: `${webRoot}${filePath}` })
  return (results[0]?.messages ?? []).filter(
    (m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax',
  )
}

const button = `import { Button } from 'react-aria-components'\nexport const X = () => <Button />\n`
const raw = `export const X = () => <button type="button" />\n`
const range = `export const X = () => <input type="range" />\n`
const aliased = `import { Button as Pressable } from 'react-aria-components'\nexport const X = () => <Pressable />\n`
const laterType = `export const X = () => <input aria-label="Volume" min={0} type="range" />\n`

const GATE_RULE =
  /eslint-disable(?:-next-line|-line)?\s+([^*\n]*no-restricted-(?:imports|syntax)[^*\n]*)/g

const matches = (file: string, pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(
    file,
  )

/** Each screen file's path and source: everything under src outside src/ui and the tests. */
function screenSources() {
  const found: { file: string; source: string }[] = []
  for (const entry of readdirSync(`${webRoot}src`, { recursive: true, encoding: 'utf8' })) {
    const file = `src/${entry}`
    if (!/\.tsx?$/.test(file) || file.startsWith('src/ui/') || /\.test\.tsx?$/.test(file)) continue
    found.push({ file, source: readFileSync(`${webRoot}${file}`, 'utf8') })
  }
  return found
}

/** Every disable of the gate's rules in a screen, with its file, form, and reason. */
function gateDisables() {
  const found: { file: string; directive: string; reason: string }[] = []
  for (const { file, source } of screenSources()) {
    for (const match of source.matchAll(GATE_RULE)) {
      const [directive = '', reason = ''] = match[0].split(/\s--\s/)
      found.push({ file, directive: directive.trim(), reason: reason.trim() })
    }
  }
  return found
}

// A disable that names no rule turns every rule off, the gate's included.
const BARE_DISABLE = /eslint-disable(?:-next-line|-line)?(?=\s*(?:\*\/|\n|$|--))/g

/** The disable directives in `source` that name no rule. */
const bareDisables = (source: string) => [...source.matchAll(BARE_DISABLE)].map((m) => m[0])

describe('control gate', () => {
  it('reports a react-aria Button imported in a feature', async () => {
    const messages = await lint(button, 'src/features/tune/Example.tsx')
    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-imports'])
    expect(messages[0]?.message).toContain('Use the control from src/ui.')
  })

  it('reports a raw <button> in a feature', async () => {
    const messages = await lint(raw, 'src/features/tune/Example.tsx')
    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-syntax'])
  })

  it('reports <input type="range"> in a feature', async () => {
    const messages = await lint(range, 'src/features/tune/Example.tsx')
    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-syntax'])
  })

  it('allows the same code in src/ui', async () => {
    expect(
      await lint(button + raw.replace('export const X', 'export const Y'), 'src/ui/Example.tsx'),
    ).toEqual([])
    expect(await lint(range, 'src/ui/Example.tsx')).toEqual([])
  })

  it('reports a control imported under another name', async () => {
    const messages = await lint(aliased, 'src/features/tune/Example.tsx')
    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-imports'])
  })

  it('reports a range input whose type is not its first attribute', async () => {
    const messages = await lint(laterType, 'src/features/tune/Example.tsx')
    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-syntax'])
  })

  it('keeps gating an allowlisted file outside its reasoned elements', async () => {
    const messages = await lint(range, 'src/features/player/Scrubber.tsx')
    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-syntax'])
  })

  it('lets each allowed element through only with its allowlist reason', () => {
    const disables = gateDisables()
    expect(disables.length).toBeGreaterThan(0)
    for (const { file, directive, reason } of disables) {
      const entry = controlAllowlist.find((allowed) => matches(file, allowed.file))
      expect(entry, `${file} is not on the control allowlist`).toBeDefined()
      expect(directive, file).toMatch(/^eslint-disable-next-line /)
      expect(reason, file).toBe(entry!.reason)
    }
  })

  it('finds a disable that names no rule in every form', () => {
    expect(bareDisables('// eslint-disable-next-line\n<button />')).toHaveLength(1)
    expect(bareDisables('/* eslint-disable */\nexport {}')).toHaveLength(1)
    expect(bareDisables('x() // eslint-disable-line')).toHaveLength(1)
    expect(bareDisables('// eslint-disable-next-line -- no rule named')).toHaveLength(1)
    expect(bareDisables('// eslint-disable-next-line no-restricted-syntax -- why')).toEqual([])
  })

  it('lets no screen turn every rule off', () => {
    const bare = screenSources().filter(({ source }) => bareDisables(source).length > 0)
    expect(bare.map(({ file }) => file)).toEqual([])
  })

  it('lists only files that hold an allowed element', () => {
    const files = gateDisables().map((disable) => disable.file)
    for (const allowed of controlAllowlist) {
      expect(
        files.some((file) => matches(file, allowed.file)),
        allowed.file,
      ).toBe(true)
    }
  })

  it('allows a test file', async () => {
    expect(await lint(raw, 'src/features/tune/Example.browser.test.tsx')).toEqual([])
  })
})
