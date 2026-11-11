import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import { emulateReducedMotion } from '../test/reducedMotion'
import { renderWithProviders } from '../test/render'
import { Row } from './Row'
import { RowList } from './RowList'
import {
  ActionSlot,
  DownloadingGlyph,
  LinkOutGlyph,
  NowPlayingGlyph,
  TransportGlyph,
} from './rowGlyphs'

it.each(['touch', 'pointer'] as const)(
  'draws every slot glyph as one ring on %s',
  async (density) => {
    const screen = renderWithProviders(
      <>
        <TransportGlyph shape="play" />
        <NowPlayingGlyph />
        <DownloadingGlyph />
        <LinkOutGlyph />
      </>,
      { density },
    )
    const glyphs = () => [...screen.container.children]
    await expect.poll(() => glyphs()).toHaveLength(4)
    const stroke = getComputedStyle(glyphs()[0]!).borderTopWidth
    const size = glyphs()[0]!.getBoundingClientRect().width
    expect(size).toBeGreaterThan(0)
    for (const glyph of glyphs()) {
      await expect.poll(() => glyph.getBoundingClientRect().width).toBe(size)
      expect(glyph.getBoundingClientRect().height).toBe(size)
      expect(getComputedStyle(glyph).borderRadius).not.toBe('0px')
      expect(getComputedStyle(glyph).borderTopStyle).toBe('solid')
      expect(getComputedStyle(glyph).borderTopWidth).toBe(stroke)
    }
    const iconStrokes = [...screen.container.querySelectorAll('svg *')]
    expect(iconStrokes.length).toBeGreaterThan(0)
    for (const line of iconStrokes) {
      expect(getComputedStyle(line).vectorEffect).toBe('non-scaling-stroke')
    }
  },
)

it('pulses the now-playing glyph', async () => {
  const screen = renderWithProviders(<NowPlayingGlyph />)
  const icon = () => screen.container.querySelector('[data-playing-glyph] svg')!
  await expect.poll(() => getComputedStyle(icon()).animationName).not.toBe('none')
})

it('does not animate the now-playing glyph under reduced motion', async () => {
  await emulateReducedMotion()
  const screen = renderWithProviders(<NowPlayingGlyph />)
  const icon = screen.container.querySelector('[data-playing-glyph] svg')!
  await expect.poll(() => getComputedStyle(icon).animationName).toBe('none')
})

it('spins the downloading arc, and hides it under reduced motion', async () => {
  const screen = renderWithProviders(<DownloadingGlyph />)
  const arc = () => screen.container.querySelector('[data-downloading-arc]')!
  await expect.poll(() => getComputedStyle(arc()).animationName).not.toBe('none')
  screen.unmount()
  await emulateReducedMotion()
  const reduced = renderWithProviders(<DownloadingGlyph />)
  const still = reduced.container.querySelector('[data-downloading-arc]')!
  await expect.poll(() => getComputedStyle(still).display).toBe('none')
})

it.each(['touch', 'pointer'] as const)(
  'keeps a row with an action slot, glyph or worded, as tall as one without on %s',
  async (density) => {
    renderWithProviders(
      <RowList label="Tunes">
        <Row id="plain" textValue="Soldier's Joy" title="Soldier's Joy" />
        <Row
          id="slot"
          textValue="Forked Deer"
          title="Forked Deer"
          trailing={
            <ActionSlot>
              <TransportGlyph shape="play" />
            </ActionSlot>
          }
        />
        <Row
          id="worded"
          textValue="Sally Goodin"
          title="Sally Goodin"
          trailing={
            <ActionSlot worded>
              <button type="button" className="t-body size-full px-2">
                Retry
              </button>
            </ActionSlot>
          }
        />
      </RowList>,
      { density },
    )
    const height = (name: string) =>
      page.getByRole('row', { name }).element().getBoundingClientRect().height
    await expect.element(page.getByRole('row', { name: 'Forked Deer' })).toBeVisible()
    await expect.element(page.getByRole('row', { name: 'Sally Goodin' })).toBeVisible()
    await expect.poll(() => height('Forked Deer')).toBe(height("Soldier's Joy"))
    await expect.poll(() => height('Sally Goodin')).toBe(height("Soldier's Joy"))
  },
)
