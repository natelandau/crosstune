// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountDemos } from '../../src/scripts/demos'

let seen: (entries: Partial<IntersectionObserverEntry>[]) => void
let teardown: (() => void) | undefined

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof seen) {
        seen = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  document.body.innerHTML = `
    <div data-places>
      <div class="scrap" data-from="-22,-14,-4"></div>
      <div class="scrap" data-from="20,18,3"></div>
    </div>`
})

afterEach(() => {
  teardown?.()
  teardown = undefined
  vi.unstubAllGlobals()
})

const scraps = () => [...document.querySelectorAll<HTMLElement>('[data-from]')]
const offsets = () => scraps().map((s) => [s.style.translate, s.style.rotate])
const enter = () =>
  seen([{ target: document.querySelector('[data-places]')!, isIntersecting: true }])

describe('the five places', () => {
  it('start scattered and drift together when they come into view', () => {
    teardown = mountDemos(document, { reducedMotion: false })
    expect(offsets()).toEqual([
      ['-22px -14px', '-4deg'],
      ['20px 18px', '3deg'],
    ])
    enter()
    expect(offsets()).toEqual([
      ['', ''],
      ['', ''],
    ])
  })

  it('drift together only once', () => {
    teardown = mountDemos(document, { reducedMotion: false })
    enter()
    scraps()[0].style.translate = '1px 1px'
    enter()
    expect(scraps()[0].style.translate).toBe('1px 1px')
  })

  it('settle when the demos unmount', () => {
    mountDemos(document, { reducedMotion: false })()
    expect(offsets()).toEqual([
      ['', ''],
      ['', ''],
    ])
  })

  it('never scatter under reduced motion', () => {
    teardown = mountDemos(document, { reducedMotion: true })
    expect(offsets()).toEqual([
      ['', ''],
      ['', ''],
    ])
  })
})
