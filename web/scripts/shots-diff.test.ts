// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./shots-diff.mjs', import.meta.url))

interface Manifest {
  same: number
  shots: { path: string; status: string; ratio?: number }[]
}

/** Runs the script on ROOT/base and ROOT/branch and returns the manifest it writes. */
async function diffShots(): Promise<Manifest> {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, join(root, 'base'), join(root, 'branch'), join(root, 'out')],
    { encoding: 'utf8' },
  )
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(await readFile(join(root, 'out/manifest.json'), 'utf8')) as Manifest
}

/** A 100 by 100 white PNG with the first `changed` pixels black. */
function png(changed = 0) {
  const image = new PNG({ width: 100, height: 100 })
  image.data.fill(255)
  for (let pixel = 0; pixel < changed; pixel += 1) image.data.fill(0, pixel * 4, pixel * 4 + 3)
  return PNG.sync.write(image)
}

let root: string

async function put(path: string, bytes: Buffer) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), bytes)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shots-diff-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('diffShots', () => {
  it('keeps changed, added, and removed shots and drops identical ones', async () => {
    await put('base/web/same.png', png())
    await put('branch/web/same.png', png())
    await put('base/web/changed.png', png())
    await put('branch/web/changed.png', png(500))
    await put('base/web/removed.png', png())
    await put('branch/web/added.png', png())

    const manifest = await diffShots()

    expect(manifest.same).toBe(1)
    expect(manifest.shots).toEqual([
      { path: 'web/added.png', status: 'added' },
      { path: 'web/changed.png', status: 'changed', ratio: 0.05 },
      { path: 'web/removed.png', status: 'removed' },
    ])
    await expect(readFile(join(root, 'out/diff/web/changed.png'))).resolves.toBeDefined()
    await expect(readFile(join(root, 'out/after/web/same.png'))).rejects.toThrow()
  })

  it('counts one changed pixel as a change', async () => {
    const big = new PNG({ width: 200, height: 100 })
    big.data.fill(255)
    const one = PNG.sync.write(big)
    big.data.fill(0, 0, 3)
    await put('base/a.png', one)
    await put('branch/a.png', PNG.sync.write(big))

    const manifest = await diffShots()

    expect(manifest.shots).toEqual([{ path: 'a.png', status: 'changed', ratio: 1 / 20000 }])
  })

  it('counts a change of size as every pixel changed', async () => {
    const wide = new PNG({ width: 120, height: 100 })
    wide.data.fill(255)
    await put('base/a.png', png())
    await put('branch/a.png', PNG.sync.write(wide))

    const manifest = await diffShots()

    expect(manifest.shots).toEqual([{ path: 'a.png', status: 'changed', ratio: 1 }])
  })
})
