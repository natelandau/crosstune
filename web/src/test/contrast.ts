/**
 * What a glyph actually reads at: the color it paints, the surface under it, and the WCAG
 * contrast between the two. A test that asserts a ratio rather than a token catches a wash
 * that is legible in one palette and lost in the other.
 */

/**
 * The channels of an rgb() or rgba() color. Anything else throws rather than measuring a
 * number nobody can trust: a stylesheet is free to hand back oklch() or a color() function,
 * and a ratio computed from the digits in one of those would be a false pass.
 */
function parts(color: string): [number, number, number, number] {
  const inside = /^rgba?\(([^)]*)\)$/.exec(color.trim())?.[1]
  const values =
    inside === undefined || inside.includes('%')
      ? []
      : inside
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number)
  if (values.length < 3 || values.length > 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`contrast: ${color} is not an rgb() or rgba() color`)
  }
  const [r, g, b, alpha = 1] = values as [number, number, number, number?]
  return [r, g, b, alpha]
}

function linear(value: number): number {
  const channel = value / 255
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** The color a glyph paints, with the element's own opacity folded into its alpha. */
export function glyphInk(element: Element): string {
  const style = getComputedStyle(element)
  const [r, g, b, alpha] = parts(style.color)
  return `rgba(${r}, ${g}, ${b}, ${alpha * Number(style.opacity)})`
}

/**
 * The first opaque surface under an element. A web component paints its own background inside
 * its shadow root, so the walk looks there before it leaves the host.
 */
export function paintedBackground(element: Element): string {
  let node: Element | null = element
  while (node) {
    const own = getComputedStyle(node).backgroundColor
    if (parts(own)[3] === 1) return own
    const shadow = (node as HTMLElement).shadowRoot
    for (const child of shadow ? Array.from(shadow.children) : []) {
      const painted = getComputedStyle(child).backgroundColor
      if (parts(painted)[3] === 1) return painted
    }
    const root = node.getRootNode()
    node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  }
  return getComputedStyle(document.body).backgroundColor
}

/** The WCAG ratio between a foreground, composited over the background where it is translucent. */
export function contrastRatio(foreground: string, background: string): number {
  const [fr, fg, fb, alpha] = parts(foreground)
  const [br, bg, bb] = parts(background)
  const over = luminance(
    fr * alpha + br * (1 - alpha),
    fg * alpha + bg * (1 - alpha),
    fb * alpha + bb * (1 - alpha),
  )
  const under = luminance(br, bg, bb)
  return (Math.max(over, under) + 0.05) / (Math.min(over, under) + 0.05)
}

/** How far a glyph stands out from whatever it sits on. */
export function glyphContrast(element: Element): number {
  return contrastRatio(glyphInk(element), paintedBackground(element))
}
