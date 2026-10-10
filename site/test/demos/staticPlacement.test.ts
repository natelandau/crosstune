import { describe, expect, it } from 'vitest'
import { DEMOS } from '../../src/demos/index'
import { withPlacementVars } from '../../src/demos/staticPlacement'

describe('withPlacementVars', () => {
  it('copies placement attributes into CSS variables', () => {
    expect(
      withPlacementVars('<div class="ph" data-l="1130" data-y="84" data-lm="-150" data-ym="176">'),
    ).toBe(
      '<div class="ph" data-l="1130" data-y="84" data-lm="-150" data-ym="176" style="--l:1130;--y:84;--lm:-150;--ym:176">',
    )
  })

  it('keeps a style the element already has', () => {
    expect(withPlacementVars('<div style="width:1240px" data-r="56" data-y="68">')).toBe(
      '<div style="width:1240px;--r:56;--y:68" data-r="56" data-y="68">',
    )
  })

  it('leaves elements without a placement alone', () => {
    expect(withPlacementVars('<span class="kp">D</span>')).toBe('<span class="kp">D</span>')
  })

  it.each(Object.keys(DEMOS))('gives every placed device in the %s demo a top', (name) => {
    const html = withPlacementVars(DEMOS[name as keyof typeof DEMOS].markup())
    for (const [tag] of html.matchAll(/<[^>]*\bdata-y="[^"]*"[^>]*>/g)) {
      expect(tag).toMatch(/--y:-?[\d.]+/)
    }
  })
})
