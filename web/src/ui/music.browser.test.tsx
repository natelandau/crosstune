import { cdp, page, userEvent } from 'vitest/browser'
import { describe, expect, it, onTestFinished } from 'vitest'
import { STATUS_LABELS } from '../constants'
import { contrastRatio, paintedBackground } from '../test/contrast'
import { renderWithProviders } from '../test/render'
import { Capsule } from './Capsule'
import { KeyPill } from './KeyPill'
import { StatusGlyph } from './StatusGlyph'

it.each([
  ['known', STATUS_LABELS.known],
  ['learning', STATUS_LABELS.learning],
  ['want_to_learn', STATUS_LABELS.want_to_learn],
  ['something_new', STATUS_LABELS.want_to_learn],
])('names the %s glyph %s', async (status, name) => {
  renderWithProviders(<StatusGlyph status={status} />)
  await expect.element(page.getByRole('img', { name })).toBeVisible()
})

it('hides a labelled glyph from assistive technology', async () => {
  renderWithProviders(<StatusGlyph status="known" labelled />)
  await expect.element(page.getByText(STATUS_LABELS.known)).toBeVisible()
  expect(page.getByRole('img', { name: STATUS_LABELS.known }).elements()).toHaveLength(0)
})

// The glyph's shape is painted by its border, so contrast is read from that color. Learning's
// light orange is the design rules' one exception.
it.each([
  ['light', ['known', 'want_to_learn']],
  ['dark', ['known', 'learning', 'want_to_learn']],
] as const)('each glyph passes 3:1 in %s', async (scheme, statuses) => {
  renderWithProviders(
    <>
      {statuses.map((s) => (
        <StatusGlyph key={s} status={s} />
      ))}
    </>,
    { scheme },
  )
  await expect.element(page.getByRole('img', { name: STATUS_LABELS.known })).toBeVisible()
  const images = page.getByRole('img').elements()
  expect(images).toHaveLength(statuses.length)
  for (const img of images) {
    const background = paintedBackground(img.parentElement as Element)
    expect(contrastRatio(getComputedStyle(img).borderTopColor, background)).toBeGreaterThanOrEqual(
      3,
    )
  }
})

it('shows the word as a pointer tooltip', async () => {
  renderWithProviders(<StatusGlyph status="known" />, { density: 'pointer' })
  const glyph = page.getByRole('img', { name: STATUS_LABELS.known })
  // React Aria opens a hover tooltip only once it has seen a pointer press.
  await userEvent.click(glyph)
  await userEvent.unhover(glyph)
  await userEvent.hover(glyph)
  await expect.element(page.getByRole('tooltip')).toHaveTextContent(STATUS_LABELS.known)
})

it('is not a tab stop', async () => {
  renderWithProviders(<StatusGlyph status="known" />, { density: 'pointer' })
  await expect.element(page.getByRole('img', { name: STATUS_LABELS.known })).toBeVisible()
  await userEvent.tab()
  await expect.poll(() => document.activeElement).toBe(document.body)
})

it('gives two spellings of one pitch one color', async () => {
  renderWithProviders(
    <>
      <KeyPill value="Bb" />
      <KeyPill value="A#" />
    </>,
  )
  const fill = (t: string) =>
    getComputedStyle(page.getByText(t, { exact: true }).element()).backgroundColor
  await expect.element(page.getByText('Bb', { exact: true })).toBeVisible()
  await expect.poll(() => fill('Bb')).toBe(fill('A#'))
})

it('marks a chosen pill and keeps its pitch', async () => {
  renderWithProviders(
    <>
      <KeyPill value="G" />
      <KeyPill value="G" chosen />
    </>,
  )
  const [resting, chosen] = page.getByText('G', { exact: true }).elements()
  await expect.element(page.getByText('G', { exact: true }).first()).toBeVisible()
  expect(resting).not.toHaveAttribute('data-chosen')
  expect(chosen).toHaveAttribute('data-chosen')
  expect(resting!.dataset.pitch).toBe(chosen!.dataset.pitch)
})

it('gives an unreadable key the neutral fill and keeps the suffix', async () => {
  renderWithProviders(
    <>
      <KeyPill value="Am" />
      <KeyPill value="D" suffix=" mix" />
    </>,
  )
  await expect.element(page.getByText('D mix', { exact: true })).toBeVisible()
  const bg = (t: string) =>
    getComputedStyle(page.getByText(t, { exact: true }).element()).backgroundColor
  await expect.poll(() => bg('Am')).not.toBe(bg('D mix'))
})

it.each(['pointer', 'touch'] as const)(
  'a full pill on %s is as tall as a capsule',
  async (density) => {
    renderWithProviders(
      <>
        <KeyPill value="D" />
        <Capsule label="Key: Any" />
      </>,
      { density },
    )
    const pill = page.getByText('D', { exact: true })
    const capsule = page.getByRole('button', { name: 'Key: Any' })
    await expect.element(capsule).toBeVisible()
    await expect
      .poll(() => pill.element().getBoundingClientRect().height)
      .toBe(capsule.element().getBoundingClientRect().height)
  },
)

it('renders nothing for a blank key', async () => {
  const { container } = renderWithProviders(<KeyPill value="  " />)
  // The toast provider's live region is always mounted.
  expect(container.querySelector(':scope > :not([role="status"])')).toBeNull()
})

it('sizes a compact pill for touch when no density is stamped', async () => {
  renderWithProviders(<KeyPill value="D" compact />, { density: 'touch' })
  const pill = page.getByText('D', { exact: true })
  await expect.element(pill).toBeVisible()
  const touch = pill.element().getBoundingClientRect().height
  document.documentElement.dataset.density = 'pointer'
  await expect.poll(() => pill.element().getBoundingClientRect().height).not.toBe(touch)
  delete document.documentElement.dataset.density
  await expect.poll(() => pill.element().getBoundingClientRect().height).toBe(touch)
})

it('keeps Learning unlike Unknown in forced colors', async () => {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'forced-colors', value: 'active' }],
  })
  onTestFinished(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [] })
  })
  renderWithProviders(
    <>
      <StatusGlyph status="learning" />
      <StatusGlyph status="want_to_learn" />
    </>,
  )
  await expect.poll(() => matchMedia('(forced-colors: active)').matches).toBe(true)
  const fill = (name: string) =>
    getComputedStyle(page.getByRole('img', { name }).element()).backgroundImage
  await expect.poll(() => fill(STATUS_LABELS.learning)).toContain('linear-gradient')
  expect(fill(STATUS_LABELS.want_to_learn)).toBe('none')
})

const PITCHES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

describe.each(['light', 'dark'] as const)('compact key pills in %s', (scheme) => {
  it.each([false, true])('read at 4.5:1 for all twelve pitches, chosen %s', async (chosen) => {
    renderWithProviders(
      <>
        {PITCHES.map((key) => (
          <KeyPill key={key} value={key} compact chosen={chosen} />
        ))}
      </>,
      { scheme },
    )
    const pills = () => PITCHES.map((key) => page.getByText(key, { exact: true }).element())
    await expect
      .poll(() => new Set(pills().map((p) => (p as HTMLElement).dataset.pitch)).size)
      .toBe(12)
    await expect
      .poll(() =>
        pills()
          .map((pill) => {
            const style = getComputedStyle(pill)
            return {
              key: pill.textContent,
              ratio: contrastRatio(style.color, style.backgroundColor),
            }
          })
          .filter(({ ratio }) => ratio < 4.5),
      )
      .toEqual([])
  })
})
