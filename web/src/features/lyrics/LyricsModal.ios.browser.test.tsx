import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { LyricsModal } from './LyricsModal'

const LONG_TITLE = "The Girl I Left Behind Me's Return to Camptown Races Waltz"

function show(title: string) {
  renderIonic(<LyricsModal open songId="s1" title={title} lyrics="One" onClose={() => {}} />, {
    db: openTestDb(),
  })
  return expect.element(page.getByRole('dialog', { name: `${title} lyrics` })).toBeVisible()
}

const openModal = () => document.querySelector('ion-modal:not(.overlay-hidden)')!

describe('LyricsModal on iOS', () => {
  it('keeps a long song title clear of the size and close controls at phone width', async () => {
    await page.viewport(320, 640)
    try {
      await show(LONG_TITLE)
      const modal = openModal()
      const titleInner = modal
        .querySelector('ion-title')!
        .shadowRoot!.querySelector('.toolbar-title')!
      const title = titleInner.getBoundingClientRect()
      const controls = modal.querySelector('ion-buttons[slot="end"]')!.getBoundingClientRect()
      expect(title.right).toBeLessThanOrEqual(controls.left)
      // The title box is narrower than its own text, so it cleared the controls by eliding,
      // not by fitting the long title in whole.
      expect(titleInner.scrollWidth).toBeGreaterThan(titleInner.clientWidth)
    } finally {
      await page.viewport(390, 844)
    }
  })
})
