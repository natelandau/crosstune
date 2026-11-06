import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import { computedColor } from '../test/color'
import { emulateReducedMotion } from '../test/reducedMotion'
import { renderWithProviders } from '../test/render'
import { Row } from './Row'
import { RowList } from './RowList'
import {
  ActionSlot,
  DownloadGlyph,
  DownloadingGlyph,
  LinkOutGlyph,
  NowPlayingGlyph,
  TransportGlyph,
} from './rowGlyphs'

it('draws an outlined ring with no fill at rest and when loaded', async () => {
  const screen = renderWithProviders(
    <>
      <TransportGlyph shape="play" />
      <TransportGlyph shape="stop" />
    </>,
  )
  const discs = () => [...screen.container.querySelectorAll('[data-row-ring]')]
  await expect.poll(() => discs()).toHaveLength(2)
  for (const disc of discs()) {
    await expect.poll(() => getComputedStyle(disc).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    // Chromium snaps a computed border width to whole device pixels, so this reads only that a
    // ring is drawn, in the glyph's own color.
    await expect.poll(() => getComputedStyle(disc).borderTopStyle).toBe('solid')
    expect(getComputedStyle(disc).borderTopColor).toBe(getComputedStyle(disc).color)
  }
})

it.each([
  ['touch', 24],
  ['pointer', 20],
] as const)('draws every slot glyph as one ring on %s', async (density, size) => {
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
    expect(getComputedStyle(line).strokeWidth).toBe('1.5px')
  }
})

it.each([
  ['touch', 24],
  ['pointer', 20],
] as const)(
  "draws download as a cloud with no ring, in the ring's box on %s",
  async (density, size) => {
    const screen = renderWithProviders(<DownloadGlyph />, { density })
    const glyph = () => screen.container.querySelector('svg.lucide-cloud-download')
    await expect.poll(() => glyph()?.getBoundingClientRect().width).toBe(size)
    expect(glyph()!.getBoundingClientRect().height).toBe(size)
    expect(getComputedStyle(glyph()!).borderTopWidth).toBe('0px')
  },
)

it('draws play in the accent role when asked', async () => {
  const screen = renderWithProviders(<TransportGlyph shape="play" tone="accent" />)
  const glyph = screen.container.children[0]!
  const accent = computedColor('var(--color-accent)')
  await expect.poll(() => getComputedStyle(glyph).color).toBe(accent)
  expect(getComputedStyle(glyph).borderTopColor).toBe(accent)
})

it('dims an offline download with the tertiary text role', async () => {
  const screen = renderWithProviders(<DownloadGlyph dimmed />)
  const glyph = screen.container.children[0]!
  await expect
    .poll(() => getComputedStyle(glyph).color)
    .toBe(computedColor('var(--color-text-tertiary)'))
  expect(getComputedStyle(glyph).opacity).toBe('1')
})

it('draws the downloading ring in secondary text and its arc in primary text', async () => {
  const screen = renderWithProviders(<DownloadingGlyph />)
  const ring = screen.container.children[0]!
  const arc = ring.querySelector('[data-downloading-arc]')!
  await expect
    .poll(() => getComputedStyle(ring).borderTopColor)
    .toBe(computedColor('var(--color-text-secondary)'))
  expect(getComputedStyle(arc).borderTopColor).toBe(computedColor('var(--color-text-primary)'))
})

it('pulses the now-playing glyph', async () => {
  const screen = renderWithProviders(<NowPlayingGlyph />)
  const icon = () => screen.container.querySelector('[data-playing-glyph] svg')!
  await expect.poll(() => getComputedStyle(icon()).animationName).toBe('pulse')
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
  await expect.poll(() => getComputedStyle(arc()).animationName).toBe('spin')
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
