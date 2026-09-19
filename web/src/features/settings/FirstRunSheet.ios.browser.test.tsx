import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { RecordProvider } from '../recording/useRecord'
import { FIRST_RUN_TITLE, FirstRunSheet } from './FirstRunSheet'

function show() {
  renderIonic(
    <RecordProvider>
      <FirstRunSheet />
    </RecordProvider>,
    {
      db: openTestDb(),
      engine: fakeEngine({ lastSyncedAt: () => '2026-09-16T12:00:00.000Z' }),
    },
  )
  // The question waits out its own grace before it opens, so this outlasts the usual poll.
  return expect
    .element(page.getByRole('dialog', { name: FIRST_RUN_TITLE }), { timeout: 5000 })
    .toBeVisible()
}

const openModal = () => document.querySelector('ion-modal:not(.overlay-hidden)')!

describe('FirstRunSheet on ios', () => {
  it('shows the whole question in the title rather than eliding it', async () => {
    await show()
    const title = openModal().querySelector('ion-title')!
    // Ionic draws the title inside its shadow root, which is where the clipping would happen.
    const drawn = title.shadowRoot!.querySelector('.toolbar-title')!
    expect(title.textContent).toBe(FIRST_RUN_TITLE)
    expect(drawn.scrollWidth).toBeLessThanOrEqual(drawn.clientWidth + 1)
    expect(drawn.scrollHeight).toBeLessThanOrEqual(drawn.clientHeight + 1)
  })

  it('keeps the title between the button slots rather than across the whole bar', async () => {
    await show()
    // An iOS title is otherwise laid across the bar with the buttons over it, which leaves a long
    // title the width between its own padding rather than the width the bar has free.
    const modal = openModal()
    const title = modal.querySelector('ion-title')!.getBoundingClientRect()
    const done = modal.querySelector('.sheet-toolbar ion-button')!.getBoundingClientRect()
    expect(title.right).toBeLessThanOrEqual(done.left)
  })

  it.each([390, 360])('centers the title on the bar at %ipx, with one button', async (width) => {
    await page.viewport(width, 844)
    try {
      await show()
      const modal = openModal()
      const bar = modal.querySelector('.sheet-toolbar')!.getBoundingClientRect()
      const titleEl = modal.querySelector('ion-title')!
      const title = titleEl.getBoundingClientRect()
      // A bar with Done and no Cancel would otherwise carry the title into the room the empty
      // start slot leaves, which reads as left of center rather than centered.
      const off = title.left + title.width / 2 - (bar.left + bar.width / 2)
      expect(Math.abs(off)).toBeLessThanOrEqual(1)
      // Centering costs title room, so the whole question still has to fit without clipping.
      const drawn = titleEl.shadowRoot!.querySelector('.toolbar-title')!
      expect(drawn.scrollWidth).toBeLessThanOrEqual(drawn.clientWidth + 1)
      expect(drawn.scrollHeight).toBeLessThanOrEqual(drawn.clientHeight + 1)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('keeps Done against the trailing edge of the bar', async () => {
    await show()
    const modal = openModal()
    const bar = modal.querySelector('.sheet-toolbar')!.getBoundingClientRect()
    const slot = modal.querySelector('.sheet-toolbar ion-buttons[slot="end"]')!
    const done = slot.querySelector('ion-button')!.getBoundingClientRect()
    // The slot reserves room the button does not fill, and the button belongs at its far end.
    expect(slot.getBoundingClientRect().right - done.right).toBeLessThanOrEqual(2)
    expect(bar.right - done.right).toBeLessThan(16)
  })
})
