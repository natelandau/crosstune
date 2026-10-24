/** A color as the browser computes it, so a token compares with a computed style. */
export function computedColor(color: string): string {
  const probe = document.createElement('span')
  probe.style.color = color
  document.body.append(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}
