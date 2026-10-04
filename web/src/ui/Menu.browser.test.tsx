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

  describe('a menu without a checked item', () => {
    function Plain() {
      const openMenu = useMenu()
      const items: MenuItem[] = [
        { label: 'Paste link', onPress: () => {} },
        { label: 'Find recordings', onPress: () => {} },
      ]
      return <IonButton onClick={(event) => openMenu(event, 'Add recording', items)}>Add</IonButton>
    }

    it('keeps its ordinary items on the popover', async () => {
      renderIonic(<Plain />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Add'))
      await expect
        .poll(() =>
          [...document.querySelectorAll('ion-popover ion-item')].map((el) => el.textContent),
        )
        .toEqual(['Paste link', 'Find recordings'])
      expect(document.querySelector('ion-popover [role="menu"]')).toBeNull()
      expect(document.querySelector('ion-popover [role="menuitemradio"]')).toBeNull()
    })

    it('keeps plain buttons on the action sheet', async () => {
      forceTouch()
      renderIonic(<Plain />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Add'))
      const buttons = () => [...document.querySelectorAll('ion-action-sheet button')]
      await expect
        .poll(() => buttons().map((el) => el.textContent?.trim()))
        .toEqual(['Paste link', 'Find recordings', 'Cancel'])
      for (const button of buttons()) {
        expect(button.getAttribute('role')).not.toBe('radio')
        expect(button.hasAttribute('aria-checked')).toBe(false)
        expect(button.hasAttribute('aria-current')).toBe(false)
      }
    })
  })

  describe('a single-choice menu', () => {
    const LABELS = ['Date recorded', 'Title', 'Tune']

    function Sorter({
      onPick,
      extra = {},
    }: {
      onPick: (label: string) => void
      extra?: Record<string, Partial<MenuItem>>
    }) {
      const openMenu = useMenu()
      const items: MenuItem[] = LABELS.map((label) => ({
        label,
        checked: label === 'Title',
        onPress: () => onPick(label),
        ...extra[label],
      }))
      return <IonButton onClick={(event) => openMenu(event, 'Sort', items)}>Sort</IonButton>
    }

    /** Resolves once the popover has presented and taken focus, which it does after its items show. */
    const popoverFocused = async () => {
      await expect
        .poll(
          () => document.querySelector('ion-popover')?.contains(document.activeElement) ?? false,
        )
        .toBe(true)
      return document.querySelector<HTMLElement>('ion-popover:not(.overlay-hidden)')!
    }

    /** The popover's menu radios, each with its checked state and whether it shows a check. */
    const popoverChoices = () =>
      [...document.querySelectorAll('ion-popover button[role="menuitemradio"]')].map((el) => [
        el.querySelector('[data-menu-label]')?.textContent,
        el.getAttribute('aria-checked'),
        el.querySelector('svg.lucide-check') !== null,
      ])

    /** The action sheet's choices, each with its current state and the icons it shows. */
    const sheetChoices = () =>
      [...document.querySelectorAll('ion-action-sheet button')]
        .filter((el) => el.textContent?.trim() !== 'Cancel')
        .map((el) => {
          const icon = el.querySelector('ion-icon') as (HTMLElement & { icon?: string }) | null
          const names = [...(icon?.icon ?? '').matchAll(/lucide-([a-z-]+?)["\s]/g)].map(
            (match) => match[1],
          )
          return [el.textContent?.trim(), el.getAttribute('aria-current'), names]
        })

    it('marks the checked item on the popover', async () => {
      renderIonic(<Sorter onPick={() => {}} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Sort'))
      await expect.poll(popoverChoices).toEqual([
        ['Date recorded', 'false', false],
        ['Title', 'true', true],
        ['Tune', 'false', false],
      ])
    })

    it('puts the popover radio state on the element that takes focus', async () => {
      renderIonic(<Sorter onPick={() => {}} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Sort'))
      await popoverFocused()
      const title = document.querySelector<HTMLElement>('ion-popover [aria-checked="true"]')!
      title.focus()
      await expect.poll(() => document.activeElement).toBe(title)
      expect(title.tagName).toBe('BUTTON')
      expect(title.closest('[role="menu"]')?.getAttribute('aria-label')).toBe('Sort')
      expect(title.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    })

    it('moves focus among the popover items with the arrow, Home, and End keys', async () => {
      renderIonic(<Sorter onPick={() => {}} extra={{ Tune: { disabled: 'Offline' } }} />, {
        db: openTestDb(),
      })
      await userEvent.click(await screen.findByText('Sort'))
      const popover = await popoverFocused()
      const focused = () =>
        document.activeElement?.querySelector('[data-menu-label]')?.textContent ?? null
      popover.focus()
      await expect.poll(() => document.activeElement).toBe(popover)
      await userEvent.keyboard('{ArrowDown}')
      await expect.poll(focused).toBe('Date recorded')
      await userEvent.keyboard('{ArrowDown}')
      await expect.poll(focused).toBe('Title')
      // Tune is disabled, so it is skipped, and the last item does not wrap to the first.
      await userEvent.keyboard('{ArrowDown}')
      await expect.poll(focused).toBe('Title')
      await userEvent.keyboard('{ArrowUp}')
      await expect.poll(focused).toBe('Date recorded')
      await userEvent.keyboard('{ArrowUp}')
      await expect.poll(focused).toBe('Date recorded')
      await userEvent.keyboard('{End}')
      await expect.poll(focused).toBe('Title')
      await userEvent.keyboard('{Home}')
      await expect.poll(focused).toBe('Date recorded')
    })

    it("shows an item's icon, reason, tone, and destructive rule on the popover", async () => {
      renderIonic(
        <Sorter
          onPick={() => {}}
          extra={{
            Title: { icon: Link, description: 'A to Z' },
            'Date recorded': { refused: 'Needs a connection' },
            Tune: { tone: 'error' },
          }}
        />,
        { db: openTestDb() },
      )
      await userEvent.click(await screen.findByText('Sort'))
      await expect.poll(popoverChoices).toHaveLength(3)
      const choice = (label: string) =>
        [...document.querySelectorAll('ion-popover [role="menuitemradio"]')].find(
          (el) => el.querySelector('[data-menu-label]')?.textContent === label,
        )!
      const title = choice('Title')
      expect(title.querySelector('svg.lucide-link')).not.toBeNull()
      expect(title.querySelector('svg.lucide-check')).not.toBeNull()
      expect(title.getAttribute('aria-description')).toBe('A to Z')
      expect(choice('Date recorded').textContent).toContain('Needs a connection')
      expect(choice('Tune').classList.contains('menu-danger')).toBe(true)
      expect(choice('Tune').previousElementSibling?.getAttribute('role')).toBe('separator')
    })

    it('marks the checked item as current on the action sheet, never as a radio', async () => {
      forceTouch()
      renderIonic(<Sorter onPick={() => {}} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Sort'))
      await expect.poll(sheetChoices).toEqual([
        ['Date recorded', null, []],
        ['Title', 'true', ['check']],
        ['Tune', null, []],
      ])
      expect(document.querySelector('ion-action-sheet [role="radio"]')).toBeNull()
      expect(document.querySelector('ion-action-sheet [aria-checked]')).toBeNull()
    })

    it("shows the checked item's icon beside its check on the action sheet", async () => {
      forceTouch()
      renderIonic(
        <Sorter onPick={() => {}} extra={{ Title: { icon: Link, description: 'A to Z' } }} />,
        { db: openTestDb() },
      )
      await userEvent.click(await screen.findByText('Sort'))
      await expect.poll(sheetChoices).toEqual([
        ['Date recorded', null, []],
        ['Title', 'true', ['link', 'check']],
        ['Tune', null, []],
      ])
      const title = [...document.querySelectorAll('ion-action-sheet button')].find(
        (el) => el.textContent?.trim() === 'Title',
      )!
      expect(title.getAttribute('aria-description')).toBe('A to Z')
      expect(title.classList.contains('menu-icon-pair')).toBe(true)
    })

    it('still runs the checked item when it is chosen, on the popover', async () => {
      const onPick = vi.fn()
      renderIonic(<Sorter onPick={onPick} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Sort'))
      await userEvent.click(await screen.findByText('Title'))
      await expect.poll(() => onPick.mock.calls).toEqual([['Title']])
    })

    it('still runs the checked item when it is chosen, on the action sheet', async () => {
      forceTouch()
      const onPick = vi.fn()
      renderIonic(<Sorter onPick={onPick} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Sort'))
      await userEvent.click(await screen.findByText('Title'))
      await expect.poll(() => onPick.mock.calls).toEqual([['Title']])
    })
  })
})
