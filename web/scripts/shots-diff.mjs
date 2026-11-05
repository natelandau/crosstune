#!/usr/bin/env node
// Compares two folders of screenshots by relative path and keeps only what differs: each
// changed pair goes to OUT/before, OUT/after, and OUT/diff, and OUT/manifest.json lists every
// changed, added, and removed shot. Identical shots leave nothing behind.
//
// usage: node scripts/shots-diff.mjs BASE BRANCH OUT

import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

async function listShots(root) {
  const found = []
  async function walk(folder) {
    let entries
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.png') && !entry.name.startsWith('.'))
        found.push(relative(root, path))
    }
  }
  await walk(root)
  return found.sort()
}

// Share of pixels that differ, and the diff image; a size change counts as every pixel.
function comparePngs(beforeBytes, afterBytes) {
  const before = PNG.sync.read(beforeBytes)
  const after = PNG.sync.read(afterBytes)
  if (before.width !== after.width || before.height !== after.height)
    return { ratio: 1, diff: null }
  const diff = new PNG({ width: before.width, height: before.height })
  const count = pixelmatch(before.data, after.data, diff.data, before.width, before.height)
  return { ratio: count / (before.width * before.height), diff: PNG.sync.write(diff) }
}

async function place(source, target) {
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}

async function diffShots(baseRoot, branchRoot, outRoot) {
  await rm(outRoot, { recursive: true, force: true })
  await mkdir(outRoot, { recursive: true })
  const base = new Set(await listShots(baseRoot))
  const branch = new Set(await listShots(branchRoot))
  const shots = []
  let same = 0
  for (const path of [...new Set([...base, ...branch])].sort()) {
    if (!branch.has(path)) {
      await place(join(baseRoot, path), join(outRoot, 'before', path))
      shots.push({ path, status: 'removed' })
      continue
    }
    if (!base.has(path)) {
      await place(join(branchRoot, path), join(outRoot, 'after', path))
      shots.push({ path, status: 'added' })
      continue
    }
    const { ratio, diff } = comparePngs(
      await readFile(join(baseRoot, path)),
      await readFile(join(branchRoot, path)),
    )
    // Two runs on one commit give the same pixels, so any changed pixel is a change.
    if (ratio === 0) {
      same += 1
      continue
    }
    await place(join(baseRoot, path), join(outRoot, 'before', path))
    await place(join(branchRoot, path), join(outRoot, 'after', path))
    if (diff) {
      await mkdir(dirname(join(outRoot, 'diff', path)), { recursive: true })
      await writeFile(join(outRoot, 'diff', path), diff)
    }
    shots.push({ path, status: 'changed', ratio })
  }
  const manifest = { same, shots }
  await writeFile(join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

const [baseRoot, branchRoot, outRoot] = process.argv.slice(2)
if (!outRoot) {
  console.error('usage: node scripts/shots-diff.mjs BASE BRANCH OUT')
  process.exit(2)
}
const { same, shots } = await diffShots(baseRoot, branchRoot, outRoot)
for (const shot of shots) {
  const share = shot.ratio === undefined ? '' : ` ${(shot.ratio * 100).toFixed(2)}%`
  console.log(`${shot.status} ${shot.path}${share}`)
}
console.log(`${shots.length} differ, ${same} same`)
