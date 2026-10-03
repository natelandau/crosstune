import { IonButton } from '@ionic/react'
import { Link, Search } from 'lucide-react'
import { screen } from '@testing-library/react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
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

function Host({ onChoose, opensTab }: { onChoose: () => void; opensTab?: boolean }) {
  const openMenu = useMenu()
  const items: MenuItem[] = [{ label: 'Paste link', opensTab, onPress: onChoose }]
  return <IonButton onClick={(event) => openMenu(event, 'Add recording', items)}>Add</IonButton>
}

/** Opens the menu, picks the item, and reports what overlay was still up when its action ran. */
async function choose({ opensTab }: { opensTab?: boolean } = {}) {
  animateOverlays()
  const seen: (Element | null)[] = []
  const onChoose = vi.fn(() => {
    seen.push(presentedMenu())
  })
  renderIonic(<Host onChoose={onChoose} opensTab={opensTab} />, { db: openTestDb() })
  await userEvent.click(await screen.findByText('Add'))
  await userEvent.click(await screen.findByText('Paste link'))
  await vi.waitFor(() => expect(onChoose).toHaveBeenCalledOnce())
  return seen[0]
}

/**
 * Dismisses the open menu and opens it again from `opener`. A menu opens only once the one
 * before it has dismissed and run its chosen item, so once it is back, any action a tap on the
 * earlier menu queued has run.
 */
async function dismissAndReopen(opener: string) {
  await expect.poll(presentedMenu).not.toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.poll(presentedMenu).toBeNull()
  await userEvent.click(screen.getByText(opener))
  await expect.poll(presentedMenu).not.toBeNull()
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

  // A browser lets a page open a tab only while it handles the tap, and the menu's dismissal
  // outlasts that.
  it('runs an item that opens a tab during the tap, on the action sheet', async () => {
    forceTouch()
    expect(await choose({ opensTab: true })).not.toBeNull()
  })

  it('runs an item that opens a tab during the tap, on the popover', async () => {
    expect(await choose({ opensTab: true })).not.toBeNull()
  })

  describe('item icons', () => {
    function Iconed() {
      const openMenu = useMenu()
      const items: MenuItem[] = [
        { label: 'Paste link', icon: Link, onPress: () => {} },
        { label: 'Find recordings', icon: Search, onPress: () => {} },
      ]
      return <IonButton onClick={(event) => openMenu(event, 'Add recording', items)}>Add</IonButton>
    }

    /** The lucide icon each labeled action sheet button shows, read from its ion-icon. */
    const sheetIcons = () =>
      [...document.querySelectorAll('ion-action-sheet button')].flatMap((button) => {
        const icon = button.querySelector('ion-icon') as (HTMLElement & { icon?: string }) | null
        const name = (icon?.icon ?? '').match(/lucide-([a-z-]+?)["\s]/)?.[1]
        return button.textContent?.trim() ? [[button.textContent.trim(), name ?? null]] : []
      })

    it("shows each item's icon on the action sheet", async () => {
      forceTouch()
      renderIonic(<Iconed />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Add'))
      await expect.poll(sheetIcons).toEqual([
        ['Paste link', 'link'],
        ['Find recordings', 'search'],
        ['Cancel', null],
      ])
    })
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
      await expect.poll(presentedMenu).not.toBeNull()
      item.click()
      await dismissAndReopen('More')
      expect(onChoose).not.toHaveBeenCalled()
    })

    it('shows its reason in the action sheet and does nothing', async () => {
      forceTouch()
      const onChoose = vi.fn()
      renderIonic(<Blocked onChoose={onChoose} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      const button = (await screen.findByText(DISABLED_ITEM('Trim', 'Offline'))).closest('button')!
      await expect.poll(() => button.disabled).toBe(true)
      await expect.poll(presentedMenu).not.toBeNull()
      button.click()
      await dismissAndReopen('More')
      expect(onChoose).not.toHaveBeenCalled()
    })
  })

  describe('a refused item', () => {
    const reason = 'Search needs a connection'

    function RefusedHost({ onChoose }: { onChoose: () => void }) {
      const openMenu = useMenu()
      const items: MenuItem[] = [{ label: 'Find recordings', refused: reason, onPress: onChoose }]
      return <IonButton onClick={(event) => openMenu(event, 'Add recording', items)}>Add</IonButton>
    }

    /** Taps the refused item, then dismisses the menu and opens it again. */
    async function tapRefused() {
      const onChoose = vi.fn()
      // Every dismissal's role. The Escape is the only one that should happen, so a menu the
      // tap had already closed shows up here as a dismissal with no role.
      const dismissals: (string | undefined)[] = []
      const record = (event: Event) =>
        dismissals.push((event as CustomEvent<{ role?: string }>).detail.role)
      const events = ['ionPopoverWillDismiss', 'ionActionSheetWillDismiss']
      for (const name of events) document.addEventListener(name, record)
      onTestFinished(() => {
        for (const name of events) document.removeEventListener(name, record)
      })
      renderIonic(<RefusedHost onChoose={onChoose} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Add'))
      expect(await screen.findByText(reason)).toBeTruthy()
      await userEvent.click(await screen.findByText('Find recordings'))
      await dismissAndReopen('Add')
      return { onChoose, dismissals }
    }

    it('keeps its name and tap on the popover, shows why, and runs nothing', async () => {
      const { onChoose, dismissals } = await tapRefused()
      expect(onChoose).not.toHaveBeenCalled()
      expect(dismissals).toEqual(['backdrop'])
    })

    it('keeps its name and tap on the action sheet, shows why, and runs nothing', async () => {
      forceTouch()
      const { onChoose, dismissals } = await tapRefused()
      expect(onChoose).not.toHaveBeenCalled()
      expect(dismissals).toEqual(['backdrop'])
    })
  })
})
