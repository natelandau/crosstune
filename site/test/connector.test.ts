import { describe, expect, it } from 'vitest'
import { FEATURES } from '../src/components/features'
import { connectorPath, variantFor, type Variant } from '../src/scripts/connector'

const bulletKeys = FEATURES.flatMap((feature) =>
  (feature.bullets ?? []).map((_, i) => [feature.id, i] as const),
)

/** Every coordinate pair in a path made of M, C, and L commands, in drawing order. */
function points(d: string): Array<{ x: number; y: number }> {
  const numbers = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number)
  const out = []
  for (let i = 0; i < numbers.length; i += 2) out.push({ x: numbers[i], y: numbers[i + 1] })
  return out
}

// Two variants read as different strokes when one trait clearly differs.
function looksDifferent(a: Variant, b: Variant): boolean {
  return (
    Math.sign(a.bow) !== Math.sign(b.bow) ||
    Math.abs(a.bow - b.bow) >= 2 ||
    a.waves !== b.waves ||
    Math.abs(a.wobble - b.wobble) >= 0.5 ||
    Math.abs(a.approach - b.approach) >= 0.08 ||
    Math.abs(a.headAngle - b.headAngle) >= 0.06 ||
    Math.abs(a.headSkew - b.headSkew) >= 0.06
  )
}

describe('variantFor', () => {
  it('draws the same arrow for the same bullet every time', () => {
    expect(variantFor('practice', 1)).toEqual(variantFor('practice', 1))
  })

  it('covers the ten bullets on the page', () => {
    expect(bulletKeys).toHaveLength(10)
  })

  it('never gives two bullets on the page the same arrow', () => {
    const variants = bulletKeys.map(([id, i]) => variantFor(id, i))
    for (let a = 0; a < variants.length; a += 1) {
      for (let b = a + 1; b < variants.length; b += 1) {
        expect(
          looksDifferent(variants[a], variants[b]),
          `${bulletKeys[a]} vs ${bulletKeys[b]}`,
        ).toBe(true)
      }
    }
  })

  it('bows neighboring bullets in a section opposite ways', () => {
    for (const feature of FEATURES.filter((f) => f.bullets)) {
      const bows = feature.bullets!.map((_, i) => Math.sign(variantFor(feature.id, i).bow))
      for (let i = 1; i < bows.length; i += 1) expect(bows[i]).toBe(-bows[i - 1])
    }
  })

  it('keeps every stroke close to straight', () => {
    for (const [id, i] of bulletKeys) {
      const v = variantFor(id, i)
      expect(Math.abs(v.bow) + v.wobble).toBeLessThanOrEqual(12)
    }
  })
})

describe('connectorPath', () => {
  // The gate is at x 400, level with the active bullet; the phone's edge at x 740.
  const from = { x: 400, y: 520 }
  const to = { x: 740, y: 508 }

  for (const [id, i] of bulletKeys) {
    describe(`${id} bullet ${i}`, () => {
      const v = variantFor(id, i)
      const { line, head } = connectorPath(from, to, v)
      const pts = points(line)

      it('starts on the gate and ends exactly at the phone', () => {
        expect(line.startsWith(`M ${from.x} ${from.y} `)).toBe(true)
        expect(pts.at(-1)).toEqual(to)
      })

      it('stays between the gate and the phone, close to the straight line', () => {
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(from.x)
          expect(p.x).toBeLessThanOrEqual(to.x)
          expect(Math.abs(p.y - (from.y + to.y) / 2)).toBeLessThanOrEqual(24)
        }
      })

      it('points its arrowhead at the phone', () => {
        const [a, tip, b] = points(head)
        expect(tip).toEqual(to)
        for (const p of [a, b]) expect(p.x).toBeLessThan(to.x)
        expect(Math.hypot(to.x - a.x, to.y - a.y)).toBeCloseTo(v.headLength, 1)
        expect(Math.hypot(to.x - b.x, to.y - b.y)).toBeCloseTo(v.headLength * v.headBalance, 1)
      })
    })
  }

  it('draws a different line for each bullet between the same two points', () => {
    const lines = bulletKeys.map(([id, i]) => connectorPath(from, to, variantFor(id, i)).line)
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('still stays between the gate and the phone when the gap is narrow', () => {
    const near = { x: 430, y: 500 }
    for (const [id, i] of bulletKeys) {
      for (const p of points(connectorPath(from, near, variantFor(id, i)).line)) {
        expect(p.x).toBeGreaterThanOrEqual(from.x)
        expect(p.x).toBeLessThanOrEqual(near.x)
      }
    }
  })
})
