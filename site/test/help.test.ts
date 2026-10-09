import { describe, expect, it } from 'vitest'
import { readPage } from './dist'

const sentences = [
  'Put one tune on each line.',
  'Bullets, numbers, and checkboxes are fine.',
  'A line that ends with a colon is a heading and is skipped.',
  'A slash between titles makes two tunes.',
  'Anything else stays in the title. You can edit it before you add.',
]

describe('/help/import', () => {
  const doc = readPage('/help/import')
  const text = doc.body.textContent ?? ''

  it('has one h1', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
  })

  it.each([/paste/, /file/, /review/i])('has a heading matching %s', (pattern) => {
    const headings = [...doc.querySelectorAll('h2')].map((h) => h.textContent ?? '')
    expect(headings.some((h) => pattern.test(h))).toBe(true)
  })

  it('has a recordings section that names Unfiled', () => {
    const headings = [...doc.querySelectorAll('h2')].map((h) => h.textContent ?? '')
    expect(headings.some((h) => /recordings/i.test(h))).toBe(true)
    expect(text).toContain('Unfiled')
  })

  it.each(['Import tunes', 'Open a file'])('names the "%s" control', (name) => {
    expect(text).toContain(name)
  })

  it('says where Import lives', () => {
    expect(text.replace(/\s+/g, ' ')).toContain('open Settings, then Import and export')
  })

  it.each(sentences)('says "%s"', (sentence) => {
    expect(text.replace(/\s+/g, ' ')).toContain(sentence)
  })
})

describe('/support', () => {
  it('links the import help page', () => {
    expect(readPage('/support').querySelector('a[href="/help/import"]')).not.toBeNull()
  })
})
