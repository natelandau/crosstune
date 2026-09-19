import { IonButton } from '@ionic/react'
import { screen } from '@testing-library/react'
import { ListPlus, SquarePen, Tag } from 'lucide-react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import type { MenuItem } from '../../ui/Menu'
import { Screen } from '../../ui/Screen'
import { SelectionFooter } from './SelectionFooter'
import { SelectionProvider, useSelectionChrome } from './SelectionProvider'
import type { BulkAction } from './SelectionToolbar'
import type { SongSelection } from './useSongSelection'

let db: CrosstuneDb

const onStatus = vi.fn()

const ACTIONS: readonly BulkAction[] = [
  { label: 'Status', icon: Tag, onPress: onStatus },
  { label: 'Edit', icon: SquarePen, onPress: () => {} },
  { label: 'Add to list', icon: ListPlus, onPress: () => {} },
]
const MORE: readonly MenuItem[] = [{ label: 'Archive 2 songs', onPress: () => {} }]
const NAMES = ['Status', 'Edit', 'Add to list', 'More']

/** Reports the flag the footer publishes for the tab bar. */
function ChromeProbe() {
  const { selecting } = useSelectionChrome()
  return <p data-selecting={selecting} className="sr-only" />
}

function Harness({ count }: { count: number }) {
  const [selecting, setSelecting] = useState(true)
  const selection: SongSelection = {
    count,
    allSelected: false,
    isSelected: () => false,
    toggle: () => {},
    toggleRange: () => {},
    selectAll: () => {},
    clear: () => {},
    toggleAll: () => {},
  }
  return (
    <SelectionProvider>
      <Screen
        title={`${count} Selected`}
        level="top"
        footer={
          selecting ? <SelectionFooter selection={selection} actions={ACTIONS} more={MORE} /> : null
        }
      >
        <ChromeProbe />
        <IonButton onClick={() => setSelecting(false)}>Leave selection</IonButton>
      </Screen>
    </SelectionProvider>
  )
}

/**
 * Two footers alive at once, which is what an Ionic page transition leaves for a few hundred
 * milliseconds: the screen being left is still mounted beside the one arriving.
 */
function OverlapHarness() {
  const [first, setFirst] = useState(true)
  const [second, setSecond] = useState(false)
  const selection: SongSelection = {
    count: 2,
    allSelected: false,
    isSelected: () => false,
    toggle: () => {},
    toggleRange: () => {},
    selectAll: () => {},
    clear: () => {},
    toggleAll: () => {},
  }
  const footer = <SelectionFooter selection={selection} actions={ACTIONS} more={MORE} />
  return (
    <SelectionProvider>
      <Screen title="2 Selected" level="top" footer={first ? footer : null}>
        <ChromeProbe />
        {second ? footer : null}
        <IonButton onClick={() => setSecond(true)}>Mount the second</IonButton>
        <IonButton onClick={() => setFirst(false)}>Unmount the first</IonButton>
        <IonButton onClick={() => setSecond(false)}>Unmount the second</IonButton>
      </Screen>
    </SelectionProvider>
  )
}

const show = (count: number) => renderScreen(<Harness count={count} />, { db, path: '/catalog' })

const showOverlap = () => renderScreen(<OverlapHarness />, { db, path: '/catalog' })

const control = (name: string) => page.getByRole('button', { name })
const selecting = () => document.querySelector('[data-selecting]')!.getAttribute('data-selecting')

/** An ion-button keeps its native button in a shadow root, which `closest` never leaves. */
function host(name: string): HTMLElement {
  const root = control(name).element().getRootNode()
  return (root as ShadowRoot).host as HTMLElement
}

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('SelectionFooter on iOS', () => {
  it('shows the four actions as text buttons in order', async () => {
    show(2)
    await expect.element(control('Status')).toBeVisible()
    const footer = document.querySelector('ion-footer')!
    const labels = Array.from(footer.querySelectorAll('ion-button')).map((button) =>
      button.textContent?.trim(),
    )
    expect(labels).toEqual(NAMES)
    expect(footer.querySelector('svg')).toBeNull()
    await control('Status').click()
    expect(onStatus).toHaveBeenCalledOnce()
    for (const name of NAMES) {
      const box = host(name).getBoundingClientRect()
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  })

  it('dims them at zero selected and keeps them on screen', async () => {
    show(0)
    for (const name of NAMES) {
      await expect.element(control(name)).toBeVisible()
      await expect.element(control(name)).toBeDisabled()
    }
  })

  it('opens the More menu', async () => {
    show(2)
    await expect.element(control('More')).toBeVisible()
    await control('More').click()
    await expect.element(await screen.findByText('Archive 2 songs')).toBeVisible()
  })

  it('hides the tab bar for as long as it is mounted', async () => {
    show(2)
    await expect.element(control('Status')).toBeVisible()
    await vi.waitFor(() => expect(selecting()).toBe('true'), { timeout: 3000 })
    await control('Leave selection').click()
    await vi.waitFor(() => expect(document.querySelector('ion-footer')).toBeNull(), {
      timeout: 3000,
    })
    expect(selecting()).toBe('false')
  })

  it('keeps the tab bar hidden until the last of two footers is gone', async () => {
    showOverlap()
    await expect.element(control('Mount the second')).toBeVisible()
    await vi.waitFor(() => expect(selecting()).toBe('true'), { timeout: 3000 })
    await control('Mount the second').click()
    await vi.waitFor(() => expect(document.querySelectorAll('ion-footer')).toHaveLength(2), {
      timeout: 3000,
    })
    await control('Unmount the first').click()
    await vi.waitFor(() => expect(document.querySelectorAll('ion-footer')).toHaveLength(1), {
      timeout: 3000,
    })
    expect(selecting()).toBe('true')
    await control('Unmount the second').click()
    await vi.waitFor(() => expect(document.querySelector('ion-footer')).toBeNull(), {
      timeout: 3000,
    })
    expect(selecting()).toBe('false')
  })
})
