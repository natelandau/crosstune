import { Archive, Pencil, Trash2 } from 'lucide-react'
import { MotionGlobalConfig } from 'motion/react'
import { page, userEvent, type Locator } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { swipeLeft } from '../test/gestures'
import { renderWithProviders } from '../test/render'
import { KeyPill } from './KeyPill'
import { Row, type RowAction } from './Row'
import { RowList } from './RowList'
import { SWIPE_ACTION_WIDTH } from './RowSwipe'
import {
  ActionSlot,
  DownloadGlyph,
  DownloadingGlyph,
  LinkOutGlyph,
  NowPlayingGlyph,
  TransportGlyph,
} from './rowGlyphs'
import { StatusGlyph } from './StatusGlyph'

// A row settles open by a spring that Motion runs in its own frames; instant animations put it
// where it settles.
beforeEach(() => {
  MotionGlobalConfig.instantAnimations = true
})
afterEach(() => {
  MotionGlobalConfig.instantAnimations = false
})

const ACTIONS: RowAction[] = [
  { id: 'edit', label: 'Edit', icon: Pencil, onAction: () => {} },
  { id: 'archive', label: 'Archive', icon: Archive, tone: 'warning', onAction: () => {} },
  { id: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onAction: () => {} },
]

function ActionRows() {
  return (
    <RowList label="Items">
      <Row
        id="1"
        textValue="Item 1"
        title="Item 1"
        detail="Detail"
        trailing={<KeyPill value="G" compact />}
        actions={ACTIONS}
      />
      <Row id="2" textValue="Item 2" title="Item 2" actions={ACTIONS} />
    </RowList>
  )
}

const GLYPHS = [
  ['Play', <TransportGlyph key="play" shape="play" />],
  ['Stop', <TransportGlyph key="stop" shape="stop" />],
  ['Accent play', <TransportGlyph key="accent" shape="play" tone="accent" />],
  ['Now playing', <NowPlayingGlyph key="now" />],
  ['Downloading', <DownloadingGlyph key="downloading" />],
  ['Download', <DownloadGlyph key="download" />],
  ['Download offline', <DownloadGlyph key="dimmed" dimmed />],
  ['Link out', <LinkOutGlyph key="link" />],
] as const

function Pieces() {
  return (
    <div data-testid="pieces" className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {GLYPHS.map(([name, glyph]) => (
          <ActionSlot key={name} aria-label={name}>
            {glyph}
          </ActionSlot>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusGlyph status="known" />
        <StatusGlyph status="learning" />
        <StatusGlyph status="want_to_learn" />
        <StatusGlyph status="known" labelled />
        <StatusGlyph status="learning" labelled />
        <StatusGlyph status="want_to_learn" labelled />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <KeyPill value="G" />
        <KeyPill value="D" compact />
        <KeyPill value="A" chosen />
        <KeyPill value="E" compact chosen />
        <KeyPill value="Any" plain />
      </div>
    </div>
  )
}

/**
 * Holds every animation on its first frame, so a glyph that pulses or spins forever draws the
 * same image on every run.
 */
function holdAnimations() {
  for (const animation of document.getAnimations()) {
    animation.pause()
    animation.currentTime = 0
  }
}

async function capture(locator: Locator, name: string) {
  await document.fonts.ready
  await expect
    .poll(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    .toBe(0)
  await expect.element(locator).toMatchScreenshot(name)
}

describe.each(['light', 'dark'] as const)('%s', (scheme) => {
  it.each(['pointer', 'touch'] as const)('glyphs, status, and keys at %s', async (density) => {
    renderWithProviders(<Pieces />, { density, scheme })
    const pieces = page.getByTestId('pieces')
    await expect.element(pieces).toBeVisible()
    await expect.poll(() => document.querySelector('[data-playing-glyph] svg')).not.toBeNull()
    holdAnimations()
    await capture(pieces, `row-pieces-${scheme}-${density}`)
  })

  it('row actions under the pointer', async () => {
    renderWithProviders(<ActionRows />, { density: 'pointer', scheme })
    const row = page.getByRole('row', { name: /Item 1/ })
    await userEvent.hover(row)
    await expect.element(row.getByRole('button', { name: 'Delete' })).toBeVisible()
    await capture(page.getByRole('grid', { name: 'Items' }), `row-actions-${scheme}-pointer`)
  })

  it('row swiped open on touch', async () => {
    renderWithProviders(<ActionRows />, { density: 'touch', scheme })
    const row = page.getByRole('row', { name: /Item 1/ })
    await swipeLeft(row, ACTIONS.length * SWIPE_ACTION_WIDTH)
    await expect
      .poll(() => row.element().querySelector('[data-swipe]')?.getAttribute('data-swipe'))
      .toBe('open')
    await capture(page.getByRole('grid', { name: 'Items' }), `row-swiped-${scheme}-touch`)
  })
})
