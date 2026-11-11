import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { geometry, markShapes, parseBrand } from '../test/brand'
import { Lockup, Mark } from './Mark'

describe('Mark', () => {
  it('is decorative and sized by its class', () => {
    const { container } = render(<Mark className="h-4" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveClass('h-4')
  })

  it('draws exactly what brand/mark-dark.svg draws', () => {
    const source = parseBrand('mark-dark.svg').documentElement
    const { container } = render(<Mark />)
    const rendered = container.querySelector('svg')
    if (!rendered) throw new Error('no svg rendered')
    expect(rendered.getAttribute('viewBox')).toBe(source.getAttribute('viewBox'))
    expect(markShapes(rendered).map(geometry)).toEqual(markShapes(source).map(geometry))
  })

  it('binds the brand token to the coral the brand sources are drawn with', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../theme/tokens.css'), 'utf8')
    expect(css).toMatch(/--brand:\s*var\(--coral-400\);/)
    const token = /--coral-400:\s*(#[0-9a-f]{6});/.exec(css)?.[1]
    const [t] = markShapes(parseBrand('mark-dark.svg').documentElement)
    expect(token).toBe(t?.getAttribute('stroke'))
  })
})

describe('Lockup', () => {
  it('sets a decorative mark beside the name, sized by its class', () => {
    render(<Lockup className="text-2xl" />)
    const lockup = screen.getByText('Crosstune')
    expect(lockup.tagName).toBe('SPAN')
    expect(lockup).toHaveClass('text-2xl')
    expect(lockup.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })
})
