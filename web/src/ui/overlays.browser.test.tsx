import { IonButton } from '@ionic/react'
import { screen, waitFor } from '@testing-library/react'
import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { forceTouch } from '../test/pointer'
import { useConfirm, type ConfirmOptions } from './Confirm'

type Confirm = (options: ConfirmOptions) => Promise<boolean>
import { MORE_ACTIONS, useMenu, type MenuItem } from './Menu'
import { Sheet } from './Sheet'

/** The palette's danger color as the browser computes it, so the palette itself can change. */
function dangerColor(): string {
  const probe = document.createElement('span')
  probe.style.color = 'var(--ion-color-danger)'
  document.body.append(probe)
  try {
    return getComputedStyle(probe).color
  } finally {
    probe.remove()
  }
}

/** The destructive and cancel buttons of whichever confirmation overlay is up. */
function confirmButtons(): { destructive: HTMLElement; cancel: HTMLElement } {
  const destructive = document.querySelector<HTMLElement>(
    '.alert-button-role-destructive, .action-sheet-destructive',
  )
  const cancel = document.querySelector<HTMLElement>(
    '.alert-button-role-cancel, .action-sheet-cancel',
  )
  if (!destructive || !cancel) throw new Error('no confirmation is up')
  return { destructive, cancel }
}

function SheetHost({
  dismissible,
  onClose = () => {},
}: {
  dismissible?: boolean
  onClose?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IonButton onClick={() => setOpen(true)}>Open</IonButton>
      <Sheet
        open={open}
        title="Filters"
        dismissible={dismissible}
        onClose={() => {
          setOpen(false)
          onClose()
        }}
        end={<IonButton onClick={() => setOpen(false)}>Done</IonButton>}
      >
        <p>Sheet body</p>
      </Sheet>
    </>
  )
}

/**
 * A sheet whose title counts what is selected, the way the bulk sheets do. The control that
 * changes the count sits inside the sheet, since the backdrop covers everything behind it.
 */
function CountingSheetHost() {
  const [count, setCount] = useState(2)
  const [open, setOpen] = useState(false)
  return (
    <>
      <IonButton onClick={() => setOpen(true)}>Open</IonButton>
      <Sheet open={open} title={`Edit ${count} songs`} onClose={() => setOpen(false)}>
        <IonButton onClick={() => setCount(3)}>Select another</IonButton>
      </Sheet>
    </>
  )
}

function MenuHost({ onDelete }: { onDelete: () => void }) {
  const openMenu = useMenu()
  // Memoized so repeat opens pass the exact same array reference, the case a same-identity
  // items array must still reopen the menu.
  const items = useMemo<MenuItem[]>(
    () => [
      { label: 'Rename', onPress: () => {} },
      { label: 'Delete', icon: Trash2, tone: 'error', onPress: onDelete },
    ],
    [onDelete],
  )
  return <IonButton onClick={(event) => openMenu(event, MORE_ACTIONS, items)}>More</IonButton>
}

function WarningMenuHost({ onArchive }: { onArchive: () => void }) {
  const openMenu = useMenu()
  const items = useMemo<MenuItem[]>(
    () => [{ label: 'Archive', tone: 'warning', onPress: onArchive }],
    [onArchive],
  )
  return <IonButton onClick={(event) => openMenu(event, MORE_ACTIONS, items)}>More</IonButton>
}

function MixedMenuHost() {
  const openMenu = useMenu()
  const items = useMemo<MenuItem[]>(
    () => [
      { label: 'Delete', tone: 'error', onPress: () => {} },
      { label: 'Rename', onPress: () => {} },
    ],
    [],
  )
  return <IonButton onClick={(event) => openMenu(event, MORE_ACTIONS, items)}>More</IonButton>
}

function ChainedMenuHost({ onMove }: { onMove: () => void }) {
  const openMenu = useMenu()
  return (
    <IonButton
      onClick={(event) =>
        openMenu(event, MORE_ACTIONS, [
          {
            label: 'Move',
            onPress: () => openMenu(event, 'Move to', [{ label: 'Move to top', onPress: onMove }]),
          },
        ])
      }
    >
      More
    </IonButton>
  )
}

function ConfirmHost({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm()
  return (
    <IonButton
      onClick={() =>
        void confirm({
          title: 'Delete "Soldier\'s Joy"?',
          message: 'This removes 3 recordings.',
          action: 'Delete',
        }).then(onResult)
      }
    >
      Delete song
    </IonButton>
  )
}

function ChainedConfirmHost({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm()
  return (
    <IonButton
      onClick={() =>
        void confirm({ title: 'Remove?', message: 'First question.', action: 'Remove' })
          .then((ok) => {
            onResult(ok)
            return confirm({ title: 'Delete?', message: 'Second question.', action: 'Delete' })
          })
          .then(onResult)
      }
    >
      Ask twice
    </IonButton>
  )
}

function DoubleConfirmHost({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm()
  const ask = () =>
    void confirm({
      title: 'Delete "Soldier\'s Joy"?',
      message: 'This removes 3 recordings.',
      action: 'Delete',
    }).then(onResult)
  return (
    <IonButton
      onClick={() => {
        ask()
        ask()
      }}
    >
      Delete twice
    </IonButton>
  )
}

/** Hands the confirm function to the test, so a call can be made with a dialog already up. */
function ConfirmProbe({ onReady }: { onReady: (confirm: Confirm) => void }) {
  const confirm = useConfirm()
  useEffect(() => {
    onReady(confirm)
  }, [confirm, onReady])
  return null
}

/** What a value such as `var(--ion-color-danger)` resolves to, as a computed color string. */
function resolved(value: string): string {
  const probe = document.createElement('span')
  probe.style.color = value
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

const itemBackground = (item: Element) =>
  getComputedStyle(item.shadowRoot?.querySelector('.item-native') ?? item).backgroundColor

describe('useMenu on a mouse', () => {
  it('tints a destructive item red and leaves its row the same surface as the rest', async () => {
    renderIonic(<MixedMenuHost />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('More'))
    const destructive = (await screen.findByText('Delete')).closest('ion-item')!
    const plain = screen.getByText('Rename').closest('ion-item')!
    await waitFor(() => expect(itemBackground(destructive)).toBe(itemBackground(plain)))
    expect(getComputedStyle(screen.getByText('Delete')).color).toBe(
      resolved('var(--ion-color-danger)'),
    )
  })
})

describe('Sheet', () => {
  it('opens with its title and closes from its toolbar', async () => {
    renderIonic(<SheetHost />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Open'))
    // The sheet animates open, so its content starts in the DOM but hidden; retry the
    // visibility check rather than asserting the instant it appears.
    const body = await screen.findByText('Sheet body')
    await expect.element(body).toBeVisible()
    await expect.element(screen.getByText('Filters')).toBeVisible()
    await expect.element(page.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
    await userEvent.click(screen.getByText('Done'))
    await expect.element(body).not.toBeVisible()
  })

  it('names the dialog for the title it is showing, not the one it loaded with', async () => {
    renderIonic(<CountingSheetHost />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Open'))
    await expect.element(page.getByRole('dialog', { name: 'Edit 2 songs' })).toBeVisible()
    await userEvent.click(await screen.findByText('Select another'))
    await expect.element(page.getByRole('dialog', { name: 'Edit 3 songs' })).toBeVisible()
    expect(page.getByRole('dialog', { name: 'Edit 2 songs' }).elements()).toHaveLength(0)
  })

  it('shows its body inside the dialog on a mouse', async () => {
    renderIonic(<SheetHost />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Open'))
    const body = await screen.findByText('Sheet body')
    // toBeVisible ignores clipping, so hit-test the body to prove the dialog gives it room.
    await waitFor(() => {
      const box = body.getBoundingClientRect()
      expect(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)).toBe(body)
    })
  })

  it('gives its toolbar controls a 44px tap target', async () => {
    renderIonic(<SheetHost />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Open'))
    const done = (await screen.findByText('Done')).closest('ion-button')!
    await waitFor(() => expect(done.getBoundingClientRect().height).toBeGreaterThanOrEqual(44))
  })

  it('closes a non-dismissible sheet from its toolbar', async () => {
    const onClose = vi.fn()
    renderIonic(<SheetHost dismissible={false} onClose={onClose} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Open'))
    const body = await screen.findByText('Sheet body')
    await expect.element(body).toBeVisible()
    await userEvent.click(screen.getByText('Done'))
    await expect.element(body).not.toBeVisible()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})

describe('useMenu', () => {
  it('lists the items and runs one', async () => {
    const onDelete = vi.fn()
    renderIonic(<MenuHost onDelete={onDelete} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('More'))
    await userEvent.click(await screen.findByText('Delete'))
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce())
  })

  it('names the popover with the title the action sheet shows as its header', async () => {
    renderIonic(<MenuHost onDelete={() => {}} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('More'))
    await expect.element(page.getByRole('group', { name: MORE_ACTIONS })).toBeVisible()
  })

  it('shows a separator before the destructive item', async () => {
    renderIonic(<MenuHost onDelete={() => {}} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('More'))
    const deleteItem = (await screen.findByText('Delete')).closest('ion-item')
    expect(deleteItem?.previousElementSibling?.tagName.toLowerCase()).toBe('ion-item-divider')
  })

  it('reopens after a selection, even with the same items reference', async () => {
    const onDelete = vi.fn()
    renderIonic(<MenuHost onDelete={onDelete} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('More'))
    await userEvent.click(await screen.findByText('Rename'))
    await waitFor(() => expect(screen.queryByText('Rename')).not.toBeInTheDocument())
    await userEvent.click(await screen.findByText('More'))
    await expect.element(await screen.findByText('Delete')).toBeVisible()
  })

  it('opens a menu asked for while the previous one is still dismissing', async () => {
    const onMove = vi.fn()
    renderIonic(<ChainedMenuHost onMove={onMove} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('More'))
    await userEvent.click(await screen.findByText('Move'))
    await userEvent.click(await screen.findByText('Move to top'))
    await waitFor(() => expect(onMove).toHaveBeenCalledOnce())
  })
})

describe('useConfirm', () => {
  it('resolves true on the action and false on cancel', async () => {
    const onResult = vi.fn()
    renderIonic(<ConfirmHost onResult={onResult} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Delete song'))
    await expect.element(await screen.findByText('This removes 3 recordings.')).toBeVisible()
    await userEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false))
    // The alert removes itself from the DOM as it dismisses; wait for that to finish, or the
    // click below can land on its backdrop instead of the button underneath it.
    await waitFor(() =>
      expect(screen.queryByText('This removes 3 recordings.')).not.toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('Delete song'))
    await userEvent.click(await screen.findByText('Delete'))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true))
  })

  it('paints its destructive button in the danger color', async () => {
    renderIonic(<ConfirmHost onResult={() => {}} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Delete song'))
    await expect.element(await screen.findByText('This removes 3 recordings.')).toBeVisible()
    const { destructive, cancel } = confirmButtons()
    expect(getComputedStyle(destructive).color).toBe(dangerColor())
    expect(getComputedStyle(cancel).color).not.toBe(dangerColor())
  })

  it('presents a confirmation asked while the previous one is still dismissing', async () => {
    const onResult = vi.fn()
    renderIonic(<ChainedConfirmHost onResult={onResult} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Ask twice'))
    await userEvent.click(await screen.findByText('Remove'))
    await expect.element(await screen.findByText('Second question.')).toBeVisible()
    await userEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(onResult.mock.calls).toEqual([[true], [false]]))
  })

  it('asks once for two calls in the same tick, declining the second', async () => {
    const onResult = vi.fn()
    renderIonic(<DoubleConfirmHost onResult={onResult} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Delete twice'))
    await expect.element(await screen.findByText('This removes 3 recordings.')).toBeVisible()
    expect(screen.getAllByText('This removes 3 recordings.')).toHaveLength(1)
    await userEvent.click(screen.getByText('Delete'))
    await waitFor(() =>
      expect(screen.queryByText('This removes 3 recordings.')).not.toBeInTheDocument(),
    )
    // A second dialog queued behind the first would present once that one finishes dismissing.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.queryByText('This removes 3 recordings.')).not.toBeInTheDocument()
    expect(onResult.mock.calls).toEqual([[false], [true]])
  })

  it('keeps the guard up for the question now on screen, not the one before it', async () => {
    let confirm: Confirm | null = null
    renderIonic(
      <ConfirmProbe
        onReady={(fn) => {
          confirm = fn
        }}
      />,
      { db: openTestDb() },
    )
    await waitFor(() => expect(confirm).not.toBeNull())
    const ask = confirm!
    const results: boolean[] = []
    void ask({ title: 'Remove?', message: 'First question.', action: 'Remove' })
      .then((ok) => {
        results.push(ok)
        return ask({ title: 'Delete?', message: 'Second question.', action: 'Delete' })
      })
      .then((ok) => results.push(ok))
    await userEvent.click(await screen.findByText('Remove'))
    await expect.element(await screen.findByText('Second question.')).toBeVisible()
    // The first question's overlay has since finished dismissing, which must not hand the
    // second question's guard away: this call is declined, not queued behind it.
    let extra: boolean | null = null
    void ask({ title: 'Delete?', message: 'Third question.', action: 'Delete' }).then((ok) => {
      extra = ok
    })
    await waitFor(() => expect(extra).toBe(false))
    await userEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(results).toEqual([true, false]))
    await waitFor(() => expect(screen.queryByText('Third question.')).not.toBeInTheDocument())
  })
})

describe('on touch', () => {
  let restore: () => void

  beforeEach(() => {
    restore = forceTouch()
  })

  afterEach(() => {
    restore()
  })

  describe('useMenu', () => {
    it('lists the items and runs one', async () => {
      const onDelete = vi.fn()
      renderIonic(<MenuHost onDelete={onDelete} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      await userEvent.click(await screen.findByText('Delete'))
      await waitFor(() => expect(onDelete).toHaveBeenCalledOnce())
    })

    it('shows the title as the sheet header', async () => {
      renderIonic(<MenuHost onDelete={() => {}} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      await waitFor(() =>
        expect(document.querySelector('.action-sheet-title')?.textContent).toBe(MORE_ACTIONS),
      )
    })

    it('keeps the caller order and marks the first destructive item', async () => {
      renderIonic(<MixedMenuHost />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      const deleteButton = (await screen.findByText('Delete')).closest('button')!
      const renameButton = screen.getByText('Rename').closest('button')!
      expect(
        deleteButton.compareDocumentPosition(renameButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(deleteButton.classList.contains('menu-destructive')).toBe(true)
    })

    it('tints a destructive item red, which md gives no color of its own', async () => {
      renderIonic(<MixedMenuHost />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      const deleteButton = (await screen.findByText('Delete')).closest('button')!
      expect(getComputedStyle(deleteButton).color).toBe(resolved('var(--ion-color-danger)'))
    })

    it('rules off the destructive group with the dark palette step color in dark mode', async () => {
      document.documentElement.classList.add('ion-palette-dark')
      try {
        renderIonic(<MixedMenuHost />, { db: openTestDb() })
        await userEvent.click(await screen.findByText('More'))
        const deleteButton = (await screen.findByText('Delete')).closest('button')!
        expect(getComputedStyle(deleteButton).borderTopColor).toBe(
          resolved('var(--ion-background-color-step-150)'),
        )
      } finally {
        document.documentElement.classList.remove('ion-palette-dark')
      }
    })

    it('marks a warning item with the warning class', async () => {
      renderIonic(<WarningMenuHost onArchive={() => {}} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      const button = (await screen.findByText('Archive')).closest('button')
      expect(button?.classList.contains('menu-warning')).toBe(true)
    })

    it('opens a menu asked for while the previous one is still dismissing', async () => {
      const onMove = vi.fn()
      renderIonic(<ChainedMenuHost onMove={onMove} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('More'))
      await userEvent.click(await screen.findByText('Move'))
      await userEvent.click(await screen.findByText('Move to top'))
      await waitFor(() => expect(onMove).toHaveBeenCalledOnce())
    })
  })

  describe('useConfirm', () => {
    it('resolves true on the action and false on cancel', async () => {
      const onResult = vi.fn()
      renderIonic(<ConfirmHost onResult={onResult} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Delete song'))
      await expect.element(await screen.findByText('This removes 3 recordings.')).toBeVisible()
      await userEvent.click(screen.getByText('Cancel'))
      await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false))
      await waitFor(() =>
        expect(screen.queryByText('This removes 3 recordings.')).not.toBeInTheDocument(),
      )
      await userEvent.click(screen.getByText('Delete song'))
      await userEvent.click(await screen.findByText('Delete'))
      await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true))
    })

    it('paints its destructive button in the danger color', async () => {
      renderIonic(<ConfirmHost onResult={() => {}} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Delete song'))
      await expect.element(await screen.findByText('This removes 3 recordings.')).toBeVisible()
      const { destructive, cancel } = confirmButtons()
      expect(getComputedStyle(destructive).color).toBe(dangerColor())
      expect(getComputedStyle(cancel).color).not.toBe(dangerColor())
    })
  })
})
