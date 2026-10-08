import { Ellipsis, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { renderWithProviders } from '../test/render'
import { Button } from './Button'
import { CANCEL, DELETE, useConfirm, type ConfirmOptions } from './Confirm'
import { Menu, MenuAtPoint } from './Menu'
import { StatusGlyph } from './StatusGlyph'
import { STATUS_LABELS } from '../constants'
import { MORE_ACTIONS } from './menuCopy'

function MoreMenu({ onEdit = () => {} }: { onEdit?: () => void }) {
  return (
    <Menu
      label={MORE_ACTIONS}
      trigger={<Button label={MORE_ACTIONS} iconOnly icon={Ellipsis} />}
      items={[
        { id: 'edit', label: 'Edit', icon: Pencil, onAction: onEdit },
        { id: 'archive', label: 'Archive', icon: TriangleAlert, tone: 'warning', onAction() {} },
      ]}
      destructive={[{ id: 'delete', label: 'Delete', icon: Trash2, onAction() {} }]}
    />
  )
}

it('puts a destructive item last, after a separator, in the danger color', async () => {
  renderWithProviders(<MoreMenu />, { density: 'pointer' })
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await expect.element(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  const items = page.getByRole('menuitem').elements()
  expect(items.map((e) => e.textContent)).toEqual(['Edit', 'Archive', 'Delete'])
  expect(page.getByRole('separator').elements()).toHaveLength(1)
  const color = (name: string) =>
    getComputedStyle(page.getByRole('menuitem', { name }).element()).color
  expect(color('Delete')).not.toBe(color('Edit'))
  expect(color('Archive')).not.toBe(color('Edit'))
  expect(color('Archive')).not.toBe(color('Delete'))
})

it('runs a pointer item and closes the popover', async () => {
  const onEdit = vi.fn()
  renderWithProviders(<MoreMenu onEdit={onEdit} />, { density: 'pointer' })
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await expect.poll(() => onEdit).toHaveBeenCalledOnce()
  await expect.poll(() => page.getByRole('menu').query()).toBeNull()
})

it('opens an action sheet with Cancel on touch and runs an item', async () => {
  const onEdit = vi.fn()
  renderWithProviders(<MoreMenu onEdit={onEdit} />, { density: 'touch' })
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await expect.element(page.getByRole('dialog', { name: MORE_ACTIONS })).toBeVisible()
  await expect.element(page.getByRole('button', { name: CANCEL })).toBeVisible()
  expect(page.getByRole('separator').elements()).toHaveLength(1)
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await expect.poll(() => onEdit).toHaveBeenCalledOnce()
  await expect.poll(() => page.getByRole('dialog').query()).toBeNull()
})

it('closes the touch action sheet from Cancel without running anything', async () => {
  const onEdit = vi.fn()
  renderWithProviders(<MoreMenu onEdit={onEdit} />, { density: 'touch' })
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('button', { name: CANCEL }).click()
  await expect.poll(() => page.getByRole('dialog').query()).toBeNull()
  expect(onEdit).not.toHaveBeenCalled()
})

const OPTIONS: ConfirmOptions = {
  title: 'Delete "Soldier\'s Joy"?',
  message: 'This removes its links and list entries.',
  action: DELETE,
}

function Asker({
  onAnswer,
  options = OPTIONS,
}: {
  onAnswer: (ok: boolean) => void
  options?: ConfirmOptions
}) {
  const confirm = useConfirm()
  return <Button label="Ask" onPress={() => void confirm(options).then(onAnswer)} />
}

it.each(['touch', 'pointer'] as const)(
  'confirm resolves false from Cancel on %s',
  async (density) => {
    const onAnswer = vi.fn()
    renderWithProviders(<Asker onAnswer={onAnswer} />, { density })
    await page.getByRole('button', { name: 'Ask' }).click()
    await expect.element(page.getByText(OPTIONS.message)).toBeVisible()
    await page.getByRole('button', { name: CANCEL }).click()
    await expect.poll(() => onAnswer).toHaveBeenCalledExactlyOnceWith(false)
    await expect.poll(() => page.getByText(OPTIONS.message).query()).toBeNull()
  },
)

it.each(['touch', 'pointer'] as const)(
  'confirm resolves true only from the named action on %s',
  async (density) => {
    const onAnswer = vi.fn()
    renderWithProviders(<Asker onAnswer={onAnswer} />, { density })
    await page.getByRole('button', { name: 'Ask' }).click()
    await page.getByRole('button', { name: DELETE }).click()
    await expect.poll(() => onAnswer).toHaveBeenCalledExactlyOnceWith(true)
  },
)

it.each(['touch', 'pointer'] as const)(
  'confirm resolves false from Escape on %s',
  async (density) => {
    const onAnswer = vi.fn()
    renderWithProviders(<Asker onAnswer={onAnswer} />, { density })
    await page.getByRole('button', { name: 'Ask' }).click()
    await expect.element(page.getByText(OPTIONS.message)).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => onAnswer).toHaveBeenCalledExactlyOnceWith(false)
  },
)

it('confirm is an alert dialog on pointer', async () => {
  renderWithProviders(<Asker onAnswer={() => {}} />, { density: 'pointer' })
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect.element(page.getByRole('alertdialog', { name: OPTIONS.title })).toBeVisible()
  await page.getByRole('button', { name: CANCEL }).click()
})

it('confirm declines a second question while one is open', async () => {
  const first = vi.fn()
  const second = vi.fn()
  function Twice() {
    const confirm = useConfirm()
    return (
      <>
        <Button label="First" onPress={() => void confirm(OPTIONS).then(first)} />
        <Button label="Second" onPress={() => void confirm(OPTIONS).then(second)} />
      </>
    )
  }
  renderWithProviders(<Twice />, { density: 'pointer' })
  await page.getByRole('button', { name: 'First' }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  // The open dialog makes the page inert to a real click, so the test clicks the button itself.
  ;(
    page.getByRole('button', { name: 'Second', includeHidden: true }).element() as HTMLElement
  ).click()
  await expect.poll(() => second).toHaveBeenCalledExactlyOnceWith(false)
  expect(first).not.toHaveBeenCalled()
  await page.getByRole('button', { name: CANCEL }).click()
  await expect.poll(() => first).toHaveBeenCalledExactlyOnceWith(false)
})

it('confirm styles a warning action unlike a danger one', async () => {
  renderWithProviders(<Asker onAnswer={() => {}} options={{ ...OPTIONS, tone: 'warning' }} />, {
    density: 'pointer',
  })
  await page.getByRole('button', { name: 'Ask' }).click()
  const action = page.getByRole('button', { name: DELETE })
  await expect.element(action).toBeVisible()
  const warning = getComputedStyle(action.element()).color
  expect(warning).not.toBe(
    getComputedStyle(page.getByRole('button', { name: CANCEL }).element()).color,
  )
  await page.getByRole('button', { name: CANCEL }).click()
})

it.each(['touch', 'pointer'] as const)(
  'confirm describes the dialog by its message on %s',
  async (density) => {
    renderWithProviders(<Asker onAnswer={() => {}} />, { density })
    await page.getByRole('button', { name: 'Ask' }).click()
    const dialog = page.getByRole(density === 'pointer' ? 'alertdialog' : 'dialog', {
      name: OPTIONS.title,
    })
    await expect.element(dialog).toHaveAccessibleDescription(OPTIONS.message)
    await page.getByRole('button', { name: CANCEL }).click()
  },
)

it.each(['touch', 'pointer'] as const)(
  'confirm answers no when its asker unmounts on %s',
  async (density) => {
    const onAnswer = vi.fn()
    function Host() {
      const [shown, setShown] = useState(true)
      return (
        <>
          <Button label="Remove asker" onPress={() => setShown(false)} />
          {shown && <Asker onAnswer={onAnswer} />}
        </>
      )
    }
    renderWithProviders(<Host />, { density })
    await page.getByRole('button', { name: 'Ask' }).click()
    await expect.element(page.getByText(OPTIONS.message)).toBeVisible()
    // The open dialog makes the page inert to a real click, so the test clicks the button itself.
    ;(
      page
        .getByRole('button', { name: 'Remove asker', includeHidden: true })
        .element() as HTMLElement
    ).click()
    await expect.poll(() => onAnswer).toHaveBeenCalledExactlyOnceWith(false)
    await expect.poll(() => page.getByText(OPTIONS.message).query()).toBeNull()
  },
)

it.each(['touch', 'pointer'] as const)(
  'confirm withdraws the open question after a declined repeat call, on %s',
  async (density) => {
    const first = vi.fn()
    const second = vi.fn()
    function Host() {
      const [shown, setShown] = useState(true)
      const confirm = useConfirm()
      return (
        <>
          <Button label="Remove asker" onPress={() => setShown(false)} />
          <Button label="Again" onPress={() => void confirm(OPTIONS).then(second)} />
          {shown && <Asker onAnswer={first} />}
        </>
      )
    }
    renderWithProviders(<Host />, { density })
    await page.getByRole('button', { name: 'Ask' }).click()
    await expect.element(page.getByText(OPTIONS.message)).toBeVisible()
    const press = (name: string) =>
      (page.getByRole('button', { name, includeHidden: true }).element() as HTMLElement).click()
    // The open dialog makes the page inert to a real click, so the test clicks the buttons itself.
    press('Again')
    await expect.poll(() => second).toHaveBeenCalledExactlyOnceWith(false)
    press('Remove asker')
    await expect.poll(() => first).toHaveBeenCalledExactlyOnceWith(false)
    await expect.poll(() => page.getByText(OPTIONS.message).query()).toBeNull()
  },
)

it('confirm leaves a question owned by another caller open when a caller leaves', async () => {
  const answerB = vi.fn()
  function Host() {
    const [shownA, setShownA] = useState(true)
    return (
      <>
        <Button label="Remove A" onPress={() => setShownA(false)} />
        {shownA && <Asker onAnswer={() => {}} />}
        <AskerB />
      </>
    )
  }
  function AskerB() {
    const confirm = useConfirm()
    return <Button label="Ask B" onPress={() => void confirm(OPTIONS).then(answerB)} />
  }
  renderWithProviders(<Host />, { density: 'pointer' })
  // A asks and is answered, so its token is stale by the time it leaves.
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await page.getByRole('button', { name: CANCEL }).click()
  await expect.poll(() => page.getByText(OPTIONS.message).query()).toBeNull()
  await page.getByRole('button', { name: 'Ask B' }).click()
  await expect.element(page.getByText(OPTIONS.message)).toBeVisible()
  ;(
    page.getByRole('button', { name: 'Remove A', includeHidden: true }).element() as HTMLElement
  ).click()
  await expect.element(page.getByText(OPTIONS.message)).toBeVisible()
  expect(answerB).not.toHaveBeenCalled()
  await page.getByRole('button', { name: CANCEL }).click()
  await expect.poll(() => answerB).toHaveBeenCalledExactlyOnceWith(false)
})

it('returns focus to the trigger when the pointer menu closes', async () => {
  renderWithProviders(<MoreMenu />, { density: 'pointer' })
  const trigger = page.getByRole('button', { name: MORE_ACTIONS })
  await trigger.click()
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => page.getByRole('menu').query()).toBeNull()
  await expect.element(trigger).toHaveFocus()
})

it('moves between pointer menu items with the arrow keys', async () => {
  renderWithProviders(<MoreMenu />, { density: 'pointer' })
  await userEvent.keyboard('{Tab}{Enter}')
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(page.getByRole('menuitem', { name: 'Archive' })).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
})

it('confirm puts focus on Cancel when the alert opens', async () => {
  renderWithProviders(<Asker onAnswer={() => {}} />, { density: 'pointer' })
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect.element(page.getByRole('button', { name: CANCEL })).toHaveFocus()
  await page.getByRole('button', { name: CANCEL }).click()
})

it('confirm resolves false from a backdrop click on pointer', async () => {
  const onAnswer = vi.fn()
  renderWithProviders(<Asker onAnswer={onAnswer} />, { density: 'pointer' })
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  await userEvent.click(page.elementLocator(document.body), { position: { x: 10, y: 10 } })
  await expect.poll(() => onAnswer).toHaveBeenCalledExactlyOnceWith(false)
  await expect.poll(() => page.getByRole('alertdialog').query()).toBeNull()
})

it('tells assistive tech the touch trigger opens a sheet, and whether it is open', async () => {
  renderWithProviders(<MoreMenu />, { density: 'touch' })
  const trigger = page.getByRole('button', { name: MORE_ACTIONS })
  await expect.element(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect.element(page.getByRole('dialog', { name: MORE_ACTIONS })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: MORE_ACTIONS, includeHidden: true }))
    .toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: CANCEL }).click()
})

it('describes an item under its label', async () => {
  renderWithProviders(
    <Menu
      label={MORE_ACTIONS}
      trigger={<Button label={MORE_ACTIONS} iconOnly icon={Ellipsis} />}
      items={[{ id: 'a', label: 'Learning', description: '3 tunes', onAction() {} }]}
    />,
  )
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  const item = page.getByRole('menuitem', { name: 'Learning', exact: true })
  await expect.element(item).toHaveAccessibleDescription('3 tunes')
})

it.each([
  ['single', 'menuitemradio'],
  ['multiple', 'menuitemcheckbox'],
] as const)('marks %s choices as %s and still runs them', async (choiceMode, role) => {
  const onB = vi.fn()
  renderWithProviders(
    <Menu
      label={MORE_ACTIONS}
      choiceMode={choiceMode}
      trigger={<Button label={MORE_ACTIONS} iconOnly icon={Ellipsis} />}
      items={[
        { id: 'plain', label: 'Plain', icon: Pencil, onAction() {} },
        { id: 'a', label: 'Choice A', checked: true, onAction() {} },
        { id: 'b', label: 'Choice B', checked: false, onAction: onB },
      ]}
    />,
  )
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await expect.element(page.getByRole('menuitem', { name: 'Plain' })).toBeVisible()
  await expect
    .element(page.getByRole(role, { name: 'Choice A' }))
    .toHaveAttribute('aria-checked', 'true')
  await expect
    .element(page.getByRole(role, { name: 'Choice B' }))
    .toHaveAttribute('aria-checked', 'false')
  await page.getByRole(role, { name: 'Choice B' }).click()
  await expect.poll(() => onB).toHaveBeenCalledOnce()
  await expect.poll(() => page.getByRole('menu').query()).toBeNull()
})

it.each(['touch', 'pointer'] as const)(
  'focuses the chosen item of a single choice on open on %s',
  async (density) => {
    renderWithProviders(
      <Menu
        label={MORE_ACTIONS}
        choiceMode="single"
        trigger={<Button label={MORE_ACTIONS} iconOnly icon={Ellipsis} />}
        items={[
          { id: 'a', label: 'Choice A', checked: false, onAction() {} },
          { id: 'b', label: 'Choice B', checked: true, onAction() {} },
          { id: 'c', label: 'Choice C', checked: false, onAction() {} },
        ]}
      />,
      { density },
    )
    await page.getByRole('button', { name: MORE_ACTIONS }).click()
    await expect.element(page.getByRole('menuitemradio', { name: 'Choice B' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitemradio', { name: 'Choice C' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
    await page.getByRole('button', { name: MORE_ACTIONS }).click()
    await expect.element(page.getByRole('menuitemradio', { name: 'Choice B' })).toHaveFocus()
  },
)

it.each(['touch', 'pointer'] as const)(
  'leaves focus be when the chosen item changes while open on %s',
  async (density) => {
    const menu = (chosen: string) => (
      <Menu
        label={MORE_ACTIONS}
        choiceMode="single"
        trigger={<Button label={MORE_ACTIONS} iconOnly icon={Ellipsis} />}
        items={['a', 'b', 'c'].map((id) => ({
          id,
          label: `Choice ${id.toUpperCase()}`,
          checked: id === chosen,
          onAction() {},
        }))}
      />
    )
    const { rerender } = renderWithProviders(menu('b'), { density })
    await page.getByRole('button', { name: MORE_ACTIONS }).click()
    const choice = (name: string) => page.getByRole('menuitemradio', { name })
    await expect.element(choice('Choice B')).toHaveFocus()
    rerender(menu('a'))
    await expect.element(choice('Choice A')).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(choice('Choice C')).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await expect.element(choice('Choice B')).toHaveFocus()
  },
)

it('shows a disabled item without running it', async () => {
  const onAction = vi.fn()
  renderWithProviders(
    <Menu
      label={MORE_ACTIONS}
      trigger={<Button label={MORE_ACTIONS} iconOnly icon={Ellipsis} />}
      items={[
        { id: 'off', label: 'Off', description: 'Not yet.', disabled: true, onAction },
        { id: 'on', label: 'On', onAction() {} },
      ]}
    />,
  )
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  const off = page.getByRole('menuitem', { name: 'Off' })
  await expect.element(off).toHaveAttribute('aria-disabled', 'true')
  await off.click({ force: true })
  await expect.element(page.getByRole('menu')).toBeVisible()
  expect(onAction).not.toHaveBeenCalled()
})

it('names a menu by its own label, not by its trigger', async () => {
  renderWithProviders(
    <Menu
      label="Sort"
      trigger={<Button label="Sort by Title, A to Z" />}
      items={[{ id: 'title', label: 'Title', icon: Pencil, onAction() {} }]}
    />,
  )
  await page.getByRole('button', { name: 'Sort by Title, A to Z' }).click()
  await expect.element(page.getByRole('menu', { name: 'Sort', exact: true })).toBeVisible()
})

const TIPPED = [
  ['an icon button', () => <Button label="Add tune" iconOnly icon={Pencil} />, 'Add tune'],
  ['a status glyph', () => <StatusGlyph status="known" />, STATUS_LABELS.known],
] as const

it.each(TIPPED)(
  'closes on one Escape though the tooltip of %s comes due under the resting pointer',
  async (_, tipped, name) => {
    function Host({ at }: { at: { x: number; y: number } | null }) {
      return (
        <>
          {tipped()}
          <MenuAtPoint
            label={MORE_ACTIONS}
            at={at}
            onClose={() => rerender(<Host at={null} />)}
            items={[{ id: 'edit', label: 'Edit', icon: Pencil, onAction() {} }]}
          />
        </>
      )
    }
    const { rerender } = renderWithProviders(<Host at={null} />, { density: 'pointer' })
    const target = page.getByRole(name === 'Add tune' ? 'button' : 'img', { name })
    const menu = page.getByRole('menu', { name: MORE_ACTIONS })
    await expect.element(target).toBeVisible()
    // React Aria shows no hover tooltip until the page has seen a pointer move, which the
    // first hover supplies.
    await userEvent.hover(target)
    await userEvent.unhover(target)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await userEvent.hover(target)
      rerender(<Host at={{ x: 200, y: 200 }} />)
      await expect.element(menu).toBeVisible()
      act(() => vi.advanceTimersByTime(2000))
    } finally {
      vi.useRealTimers()
    }
    await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(menu).not.toBeInTheDocument()
  },
)
