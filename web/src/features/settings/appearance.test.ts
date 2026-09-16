import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_KEY,
  TEXT_SIZE_KEY,
  applyAppearance,
  applyTextSize,
  readAppearance,
  readTextSize,
  setAppearance,
  setTextSize,
} from './appearance'

const root = document.documentElement

afterEach(() => {
  localStorage.clear()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-text-size')
  vi.restoreAllMocks()
})

describe('appearance', () => {
  it('follows the system until the user chooses', () => {
    expect(readAppearance()).toBe('system')
    applyAppearance(readAppearance())
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('stores the choice and stamps it on the document', () => {
    setAppearance('dark')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
    setAppearance('light')
    expect(root.getAttribute('data-theme')).toBe('light')
    setAppearance('system')
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(readAppearance()).toBe('system')
  })

  it('ignores a stored value it does not know', () => {
    localStorage.setItem(APPEARANCE_KEY, 'sepia')
    localStorage.setItem(TEXT_SIZE_KEY, 'huge')
    expect(readAppearance()).toBe('system')
    expect(readTextSize()).toBe('regular')
  })

  it('still applies the choice when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    setAppearance('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(readAppearance()).toBe('system')
  })
})

describe('text size', () => {
  it('is regular by default, which needs no attribute', () => {
    expect(readTextSize()).toBe('regular')
    applyTextSize('regular')
    expect(root.hasAttribute('data-text-size')).toBe(false)
  })

  it('stores the size and stamps the other two on the document', () => {
    setTextSize('roomy')
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBe('roomy')
    expect(root.getAttribute('data-text-size')).toBe('roomy')
    setTextSize('compact')
    expect(root.getAttribute('data-text-size')).toBe('compact')
    setTextSize('regular')
    expect(root.hasAttribute('data-text-size')).toBe(false)
  })
})
