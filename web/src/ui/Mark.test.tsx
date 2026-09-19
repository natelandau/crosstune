import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { geometry, markShapes, parseBrand } from '../test/brand'
import { Lockup, Mark } from './Mark'

describe('Mark', () => {
  it('is decorative, sized by its class, and cropped to the cap height', () => {
    const { container } = render(<Mark className="h-4" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveClass('h-4')
    expect(svg).toHaveClass('shrink-0')
    expect(svg).toHaveAttribute('viewBox', '39 104 434 304')
  })

  it('draws exactly what brand/mark-dark.svg draws', () => {
    const source = parseBrand('mark-dark.svg').documentElement
    const { container } = render(<Mark />)
    const rendered = container.querySelector('svg')
    if (!rendered) throw new Error('no svg rendered')
    expect(rendered.getAttribute('viewBox')).toBe(source.getAttribute('viewBox'))
    expect(markShapes(rendered).map(geometry)).toEqual(markShapes(source).map(geometry))
  })

  it('colors the T from the mark token and the C from the text', () => {
    const { container } = render(<Mark />)
    const [t, cArc, cRect] = markShapes(container)
    expect(t?.getAttribute('stroke')).toBe('var(--color-mark)')
    expect(cArc?.getAttribute('stroke')).toBe('currentColor')
    expect(cRect?.getAttribute('fill')).toBe('currentColor')
  })

  it('binds the mark token to the coral the brand sources are drawn with', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../app/theme/variables.css'), 'utf8')
    const token = /--color-mark:\s*(#[0-9a-f]{6});/.exec(css)?.[1]
    const [t] = markShapes(parseBrand('mark-dark.svg').documentElement)
    expect(token).toBe(t?.getAttribute('stroke'))
  })
})

describe('Lockup', () => {
  it('sets the mark beside the name at the documented type role and gap', () => {
    render(<Lockup className="text-2xl" />)
    const lockup = screen.getByText('Crosstune')
    expect(lockup.tagName).toBe('SPAN')
    expect(lockup).toHaveClass('inline-flex')
    expect(lockup).toHaveClass('text-2xl')
    expect(lockup).toHaveClass('items-baseline')
    expect(lockup).toHaveClass('gap-[0.28em]')
    const svg = lockup.querySelector('svg[aria-hidden="true"]')
    expect(svg).not.toBeNull()
    expect(svg).toHaveClass('h-[0.71em]')
  })
})
