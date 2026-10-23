/** `share` of the token `toward` mixed into the token `from`, as a CSS color. */
export function blend(from: string, toward: string, share: number): string {
  // The plain token at either end, so it computes to the same color the token does elsewhere.
  if (share <= 0) return `var(${from})`
  if (share >= 1) return `var(${toward})`
  return `color-mix(in srgb, var(${toward}) ${(share * 100).toFixed(1)}%, var(${from}))`
}
