// Copies each device's placement attributes into CSS variables, so demos.css can place the first
// frame when no script runs. The script still places devices itself from the same attributes.

const KEYS = ['l', 'r', 'y', 'lm', 'ym'] as const

/** Adds `--l`, `--r`, `--y`, `--lm`, and `--ym` to the style of every element with `data-y`. */
export function withPlacementVars(html: string): string {
  return html.replace(/<([a-z][\w-]*)(\s[^>]*?\bdata-y="[^"]*"[^>]*)>/g, (_tag, name, attrs) => {
    const vars = KEYS.flatMap((key) => {
      const value = new RegExp(`\\bdata-${key}="(-?[\\d.]+)"`).exec(attrs)?.[1]
      return value === undefined ? [] : [`--${key}:${value}`]
    }).join(';')
    const style = /\bstyle="([^"]*)"/.exec(attrs)
    const merged = style
      ? attrs.replace(style[0], `style="${style[1].replace(/;?\s*$/, ';')}${vars}"`)
      : `${attrs} style="${vars}"`
    return `<${name}${merged}>`
  })
}
