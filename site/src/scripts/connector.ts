// The hand-drawn arrow from a pinned section's active bullet to its phone: its shape per bullet,
// and its SVG path between two measured points.

export type Point = { x: number; y: number }

/** One bullet's pen stroke. Lengths are CSS pixels, angles radians. */
export type Variant = {
  /** How far the line bulges off straight; positive bulges up. */
  bow: number
  /** How far the stroke strays from its line, as a hand would. */
  wobble: number
  /** How many times the stroke strays across the line's length. */
  waves: number
  /** Where along its cycle the wobble starts, 0 to 1. */
  phase: number
  /** Tilts the arrival at the phone off the line's own direction; positive arrives heading down. */
  approach: number
  /** Half the angle between the arrowhead's two strokes. */
  headAngle: number
  headLength: number
  /** Turns both arrowhead strokes one way, so the head sits a little lopsided. */
  headSkew: number
  /** The lower stroke's length as a share of the upper one's. */
  headBalance: number
}

// FNV-1a, then mulberry32: a few stable pseudo-random numbers from a short string.
function seeded(key: string): () => number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  let state = h >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The stroke for bullet `bulletIndex` of section `sectionId`: always the same for that bullet.
 * Neighboring bullets in a section bow opposite ways, and the rest of the shape comes from the
 * key, so no two bullets on the page draw alike.
 */
export function variantFor(sectionId: string, bulletIndex: number): Variant {
  const next = seeded(`${sectionId}:${bulletIndex}`)
  const between = (lo: number, hi: number) => lo + (hi - lo) * next()
  const first = seeded(sectionId)() < 0.5 ? 1 : -1
  const sign = bulletIndex % 2 === 0 ? first : -first
  return {
    bow: sign * between(2, 9),
    wobble: between(0.6, 2.4),
    waves: 1 + Math.floor(next() * 3),
    phase: next(),
    approach: between(-0.22, 0.22),
    headAngle: between(0.4, 0.62),
    headLength: between(9, 14),
    headSkew: between(-0.12, 0.12),
    headBalance: between(0.72, 1),
  }
}

const fmt = (n: number) => String(Math.round(n * 100) / 100)

/**
 * The connector from `from` (on the gate, a vertical line just right of the widest bullet, level
 * with the active bullet) to `to` (on the phone's near edge). It is a nearly straight line with a
 * hand's bow and wobble, kept between `from.x` and `to.x`, ending exactly at `to` along the angle
 * the arrowhead points.
 */
export function connectorPath(from: Point, to: Point, v: Variant): { line: string; head: string } {
  const left = from.x
  const right = Math.max(to.x, left)
  const dx = right - left
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const up = { x: dy / length, y: -dx / length }
  const angle = Math.max(-1, Math.min(1, Math.atan2(dy, Math.max(dx, 1)) + v.approach))

  // Points along the chord, pushed off it by the bow and the wobble, then joined as a
  // Catmull-Rom spline written out as cubics.
  const count = 2 + v.waves * 2
  const points: Point[] = Array.from({ length: count + 1 }, (_, k) => {
    const t = k / count
    const ends = k === 0 || k === count
    const off = ends
      ? 0
      : v.bow * Math.sin(Math.PI * t) + v.wobble * Math.sin(2 * Math.PI * (v.waves * t + v.phase))
    return { x: left + dx * t + up.x * off, y: from.y + dy * t + up.y * off }
  })
  const reach = Math.min(28, dx * 0.3)
  const clampX = (x: number) => Math.min(right, Math.max(left, x))
  const pt = (p: Point) => `${fmt(clampX(p.x))} ${fmt(p.y)}`
  const parts = [`M ${pt(points[0])}`]
  for (let k = 0; k < count; k += 1) {
    const [p0, p1, p2, p3] = [points[k - 1] ?? points[k], points[k], points[k + 1], points[k + 2]]
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 =
      k === count - 1
        ? { x: to.x - (reach / 3) * Math.cos(angle), y: to.y - (reach / 3) * Math.sin(angle) }
        : { x: p2.x - ((p3 ?? p2).x - p1.x) / 6, y: p2.y - ((p3 ?? p2).y - p1.y) / 6 }
    parts.push(`C ${pt(c1)}, ${pt(c2)}, ${pt(p2)}`)
  }

  const arm = (turn: number, size: number) => ({
    x: to.x - size * Math.cos(angle + turn),
    y: to.y - size * Math.sin(angle + turn),
  })
  const a = arm(-v.headAngle + v.headSkew, v.headLength)
  const b = arm(v.headAngle + v.headSkew, v.headLength * v.headBalance)
  const head = `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(to.x)} ${fmt(to.y)} L ${fmt(b.x)} ${fmt(b.y)}`
  return { line: parts.join(' '), head }
}
