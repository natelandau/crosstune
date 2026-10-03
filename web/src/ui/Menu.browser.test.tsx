import { IonButton } from '@ionic/react'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { animateOverlays } from '../test/overlays'
import { forceTouch } from '../test/pointer'
import { useMenu, type MenuItem } from './Menu'
import { DISABLED_ITEM } from './menuCopy'

/** The menu overlay still presented at the moment an item's action runs, if any. */
const presentedMenu = () =>
  document.querySelector('ion-action-sheet:not(.overlay-hidden), ion-popover:not(.overlay-hidden)')

function Host({ onChoose }: { onChoose: () => void }) {
  const openMenu = useMenu()
  const items: MenuItem[] = [{ label: 'Paste link', onPress: onChoose }]
  return <IonButton onClick={(event) => openMenu(event, 'Add recording', items)}>Add</IonButton>
}

/** Opens the menu, picks the item, and reports what overlay was still up when its action ran. */
async function choose() {
  animateOverlays()
  const seen: (Element | null)[] = []
  const onChoose = vi.fn(() => {
    seen.push(presentedMenu())
  })
  renderIonic(<Host onChoose={onChoose} />, { db: openTestDb() })
  await userEvent.click(await screen.findByText('Add'))
  await userEvent.click(await screen.findByText('Paste link'))
  await vi.waitFor(() => expect(onChoose).toHaveBeenCalledOnce())
  return seen[0]
}

describe('useMenu', () => {
  // An item that opens a sheet must not overlap the menu it came from: two overlays presented at
  // once leave Ionic unable to tell which one should give the page back to assistive tech.
  it('runs a chosen item only after the action sheet has closed', async () => {
    forceTouch()
    expect(await choose()).toBeNull()
  })

  it('runs a chosen item only after the popover has closed', async () => {
    expect(await choose()).toBeNull()
  })

  describe('a disabled item', () => {
    function Blocked({ onChoose }: { onChoose: () => void }) {
      const openMenu = useMenu()
      const items: MenuItem[] = [{ label: 'Trim', disabled: 'Offline', onPress: onChoose }]
      return <IonButton onClick={(event) => openMenu(event, 'More', items)}>More</IonButton>
    }

    it('shows its reason in the popover and does nothing', async () => {
      const onChoose = vi.fn()
      renderIonic(<Blocked onChoose={onChoose} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      const label = await screen.findByText('Trim')
      const item = label.closest('ion-item')!
      await vi.waitFor(() => expect(item.getAttribute('aria-disabled')).toBe('true'))
      await expect.poll(() => item.textContent).toContain('Offline')
      item.click()
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(onChoose).not.toHaveBeenCalled()
    })

    it('shows its reason in the action sheet and does nothing', async () => {
      forceTouch()
      const onChoose = vi.fn()
      renderIonic(<Blocked onChoose={onChoose} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      const button = (await screen.findByText(DISABLED_ITEM('Trim', 'Offline'))).closest('button')!
      await expect.poll(() => button.disabled).toBe(true)
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(onChoose).not.toHaveBeenCalled()
    })
  })
})
