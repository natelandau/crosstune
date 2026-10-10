import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Selection } from 'react-aria-components'
import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { longPress } from '../test/gestures'
import { renderWithProviders } from '../test/render'
import { CANCEL } from './Confirm'
import { KeyPill } from './KeyPill'
import { Row } from './Row'
import { RowList } from './RowList'
import { Sheet } from './Sheet'
import { StatusGlyph } from './StatusGlyph'

const actions = [{ id: 'edit', label: 'Edit', icon: Pencil, onAction: vi.fn() }]

it('reveals a row action to the keyboard', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Soldier's Joy" title="Soldier's Joy" actions={actions} />
    </RowList>,
    { density: 'pointer' },
  )
  await userEvent.keyboard('{Tab}{ArrowRight}')
  const edit = page.getByRole('button', { name: 'Edit' })
  await expect.element(edit).toHaveFocus()
  await expect.poll(() => Number(getComputedStyle(edit.element()).opacity)).toBe(1)
})

it('hides a resting action from sight but not from assistive tech', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Forked Deer" title="Forked Deer" actions={actions} />
    </RowList>,
    { density: 'pointer' },
  )
  const edit = page.getByRole('button', { name: 'Edit' })
  await expect.element(edit).toBeInTheDocument()
  await expect.poll(() => Number(getComputedStyle(edit.element().parentElement!).opacity)).toBe(0)
})

it('keeps a long title and the key pill on a 390px row', async () => {
  await page.viewport(390, 844)
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="t"
        title="The Ladies of Carrick on the Long Road Home to Kilkenny"
        leading={<StatusGlyph status="learning" />}
        detail="Violin Cross A (AEAE), capo 2"
        trailing={<KeyPill value="A" compact />}
      />
    </RowList>,
    { density: 'pointer' },
  )
  const pill = page.getByText('A', { exact: true })
  await expect.element(pill).toBeVisible()
  expect(pill.element().getBoundingClientRect().right).toBeLessThanOrEqual(390)
  const title = page.getByText(/The Ladies of Carrick/)
  const detail = page.getByText(/Violin Cross/)
  // The detail does not fit whole beside the title, so it wraps below the clipped line.
  const line = () => detail.element().closest('[data-row-line]')!.getBoundingClientRect()
  await expect
    .poll(() => detail.element().getBoundingClientRect().top)
    .toBeGreaterThanOrEqual(line().bottom)
  await expect.poll(() => title.element().getBoundingClientRect().width).toBeGreaterThan(150)
})

it('opens the row menu on right-click', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Waynesboro" title="Waynesboro" actions={actions} />
    </RowList>,
    { density: 'pointer' },
  )
  await page.getByRole('row', { name: /Waynesboro/ }).click({ button: 'right' })
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
})

it('opens the row menu from the keyboard and runs an item', async () => {
  const onAction = vi.fn()
  const menu = [
    { id: 'edit', label: 'Edit', icon: Pencil, onAction },
    { id: 'delete', label: 'Delete', icon: Trash2, tone: 'danger' as const, onAction: vi.fn() },
  ]
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Red Haired Boy" title="Red Haired Boy" menu={menu} />
    </RowList>,
    { density: 'pointer' },
  )
  await userEvent.keyboard('{Tab}{Shift>}{F10}{/Shift}')
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => onAction.mock.calls.length).toBe(1)
})

it('keeps 44px rows at the roomy size on touch', async () => {
  document.documentElement.dataset.textSize = 'roomy'
  try {
    renderWithProviders(
      <RowList label="Tunes">
        <Row id="1" textValue="Cluck Old Hen" title="Cluck Old Hen" />
      </RowList>,
      { density: 'touch' },
    )
    const row = page.getByRole('row', { name: /Cluck Old Hen/ })
    await expect.element(row).toBeVisible()
    await expect.poll(() => row.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  } finally {
    delete document.documentElement.dataset.textSize
  }
})

it('puts the detail on a second line on touch', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Rights of Man" title="Rights of Man" detail="Standard tuning" />
    </RowList>,
    { density: 'touch' },
  )
  const title = page.getByText('Rights of Man', { exact: true })
  const detail = page.getByText('Standard tuning')
  await expect
    .poll(() => detail.element().getBoundingClientRect().top)
    .toBeGreaterThanOrEqual(title.element().getBoundingClientRect().bottom - 1)
})

it('dims the whole row', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Old Joe" title="Old Joe" dimmed />
    </RowList>,
  )
  const row = page.getByRole('row', { name: /Old Joe/ })
  await expect.poll(() => Number(getComputedStyle(row.element()).opacity)).toBeLessThan(1)
})

it.each([
  ['pointer', 32, 32],
  ['touch', 44, Infinity],
] as const)('a %s row with actions is the target height', async (density, min, max) => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="Boil Them Cabbage" title="Boil Them Cabbage" actions={actions} />
    </RowList>,
    { density },
  )
  const row = page.getByRole('row', { name: /Boil Them/ })
  await expect.element(row).toBeVisible()
  await expect.poll(() => row.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(min)
  expect(row.element().getBoundingClientRect().height).toBeLessThanOrEqual(max)
})

it('tints a warning action differently from a neutral one', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Arkansas Traveler"
        title="Arkansas Traveler"
        actions={[
          { id: 'edit', label: 'Edit', icon: Pencil, onAction: vi.fn() },
          { id: 'archive', label: 'Archive', icon: Trash2, tone: 'warning', onAction: vi.fn() },
        ]}
      />
    </RowList>,
  )
  const color = (name: string) =>
    getComputedStyle(page.getByRole('button', { name }).element()).color
  await expect.poll(() => color('Archive')).not.toBe(color('Edit'))
})

it('does not move the row content when the menu opens', async () => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Bonaparte"
        title="Bonaparte"
        trailing={<KeyPill value="D" compact />}
        actions={actions}
      />
    </RowList>,
  )
  const title = page.getByText('Bonaparte', { exact: true })
  const pill = page.getByText('D', { exact: true })
  const edit = page.getByRole('button', { name: 'Edit' })
  await expect.element(title).toBeVisible()
  const measure = () =>
    [title, pill, edit].map((l) => {
      const r = l.element().getBoundingClientRect()
      return [r.left, r.right, r.width]
    })
  // Webfont loading re-flows text by sub-pixels; the bug this guards moved edges by 12px.
  await document.fonts.ready
  const before = measure()
  await page.getByRole('row', { name: /Bonaparte/ }).click({ button: 'right' })
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  await document.fonts.ready
  measure().forEach((box, i) =>
    box.forEach((value, j) => expect(Math.abs(value - before[i]![j]!)).toBeLessThan(1)),
  )
})

function EditingRow() {
  const [editing, setEditing] = useState(false)
  return (
    <>
      <RowList label="Tunes">
        <Row
          id="1"
          textValue="Cotton Eyed Joe"
          title="Cotton Eyed Joe"
          actions={[{ id: 'edit', label: 'Edit', icon: Pencil, onAction: () => setEditing(true) }]}
        />
      </RowList>
      <Sheet isOpen={editing} onOpenChange={setEditing} title="Edit tune">
        <p>Body</p>
      </Sheet>
    </>
  )
}

it('returns focus to the row when a long-press menu is cancelled', async () => {
  renderWithProviders(<EditingRow />, { density: 'touch' })
  const row = page.getByRole('row', { name: /Cotton Eyed Joe/ })
  await longPress(row)
  await expect.element(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  await page.getByRole('button', { name: CANCEL }).click()
  await expect.poll(() => page.getByRole('dialog').query()).toBeNull()
  await expect.element(row).toHaveFocus()
})

it('returns focus to the row after a sheet opened from its long-press menu', async () => {
  renderWithProviders(<EditingRow />, { density: 'touch' })
  const row = page.getByRole('row', { name: /Cotton Eyed Joe/ })
  await longPress(row)
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const sheet = page.getByRole('dialog', { name: 'Edit tune' })
  await expect.element(sheet).toBeVisible()
  await sheet.getByRole('button', { name: CANCEL }).click()
  await expect.poll(() => page.getByRole('dialog').query()).toBeNull()
  await expect.element(row).toHaveFocus()
})

it.each([
  ['leaves Shift+F10 to the browser on a row with no menu', [], false],
  ['takes Shift+F10 on a row with a menu', actions, true],
] as const)('%s', async (_, rowActions, taken) => {
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="Paddy on the Turnpike"
        title="Paddy on the Turnpike"
        actions={[...rowActions]}
      />
    </RowList>,
    { density: 'pointer' },
  )
  const row = page.getByRole('row', { name: /Paddy on the Turnpike/ })
  await userEvent.keyboard('{Tab}')
  await expect.element(row).toHaveFocus()
  const event = new KeyboardEvent('keydown', {
    key: 'F10',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  row.element().dispatchEvent(event)
  expect(event.defaultPrevented).toBe(taken)
  if (taken) await expect.element(page.getByRole('menu')).toBeVisible()
})

function SingleList({
  behavior,
  onChange,
}: {
  behavior: 'toggle' | 'replace'
  onChange: (keys: Selection) => void
}) {
  const [selected, setSelected] = useState<Selection>(new Set())
  return (
    <RowList
      label="Tunes"
      selectionMode="single"
      selectionBehavior={behavior}
      disallowEmptySelection
      selectedKeys={selected}
      onSelectionChange={(keys) => {
        setSelected(keys)
        onChange(keys)
      }}
    >
      <Row id="a" textValue="Angeline" title="Angeline" />
      <Row id="b" textValue="Bonaparte" title="Bonaparte" />
    </RowList>
  )
}

it('moves a single selection with the arrows when selection follows focus', async () => {
  const onChange = vi.fn()
  renderWithProviders(<SingleList behavior="replace" onChange={onChange} />)
  await page.getByRole('row', { name: 'Angeline' }).click()
  await expect
    .element(page.getByRole('row', { name: 'Angeline' }))
    .toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{ArrowDown}')
  await expect
    .element(page.getByRole('row', { name: 'Bonaparte' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(page.getByRole('row', { name: 'Angeline' }))
    .toHaveAttribute('aria-selected', 'false')
})

it('selects nothing on focus alone when selection toggles', async () => {
  const onChange = vi.fn()
  renderWithProviders(<SingleList behavior="toggle" onChange={onChange} />)
  await userEvent.keyboard('{Tab}')
  await expect.element(page.getByRole('row', { name: 'Angeline' })).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(page.getByRole('row', { name: 'Bonaparte' })).toHaveFocus()
  expect(onChange).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('row', { name: 'Bonaparte' }))
    .toHaveAttribute('aria-selected', 'true')
})

it('lays pointer actions over the row instead of taking width from the title', async () => {
  await page.viewport(390, 844)
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="t"
        title="Billy in the Lowground"
        trailing={<KeyPill value="C" compact />}
        actions={[
          ...actions,
          { id: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onAction: vi.fn() },
        ]}
      />
    </RowList>,
    { density: 'pointer' },
  )
  const pill = page.getByText('C', { exact: true })
  await expect.element(pill).toBeVisible()
  // The pill keeps its place at the trailing edge, inside the row's own padding.
  await expect
    .poll(
      () =>
        page.getByRole('row').element().getBoundingClientRect().right -
        pill.element().getBoundingClientRect().right,
    )
    .toBeLessThanOrEqual(16)
})

it("keeps a hovered row's key in view beside its actions", async () => {
  await page.viewport(390, 844)
  renderWithProviders(
    <RowList label="Tunes">
      <Row
        id="1"
        textValue="t"
        title="Billy in the Lowground"
        trailing={<KeyPill value="C" compact />}
        actions={[
          ...actions,
          { id: 'delete', label: 'Delete', icon: Trash2, tone: 'danger', onAction: vi.fn() },
        ]}
      />
    </RowList>,
    { density: 'pointer' },
  )
  const pill = page.getByText('C', { exact: true })
  await expect.element(pill).toBeVisible()
  await userEvent.hover(page.getByRole('row'))
  const edit = page.getByRole('button', { name: 'Edit' })
  await expect.poll(() => Number(getComputedStyle(edit.element().parentElement!).opacity)).toBe(1)
  const onTop = () => {
    const box = pill.element().getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return hit !== null && pill.element().contains(hit)
  }
  await expect.poll(onTop).toBe(true)
  // The actions end where the key begins, so they never cover it.
  await expect
    .poll(
      () =>
        edit.element().parentElement!.getBoundingClientRect().right <=
        pill.element().getBoundingClientRect().left + 0.5,
    )
    .toBe(true)
})

it('gives a row with nothing trailing its full width for the title', async () => {
  await page.viewport(390, 844)
  renderWithProviders(
    <RowList label="Tunes">
      <Row id="1" textValue="t" title="Forked Deer" />
    </RowList>,
    { density: 'pointer' },
  )
  const title = page.getByText('Forked Deer', { exact: true })
  await expect.element(title).toBeVisible()
  // The title's line reaches the row's content edge, inside its 12px padding.
  await expect
    .poll(() => {
      const row = page.getByRole('row').element().getBoundingClientRect()
      const line = title.element().closest('[data-row-line]')!.getBoundingClientRect()
      return row.right - line.right
    })
    .toBeLessThanOrEqual(12.5)
})

/** What the wash token paints, read from an element that shows it alone. */
function washColor(): string {
  const probe = document.createElement('div')
  probe.style.backgroundColor = 'var(--wash)'
  document.body.append(probe)
  const color = getComputedStyle(probe).backgroundColor
  probe.remove()
  return color
}

function pointer(target: Element, type: string, pointerType: 'mouse' | 'touch') {
  const rect = target.getBoundingClientRect()
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 3,
      pointerType,
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: rect.left + 10,
      clientY: rect.top + rect.height / 2,
    }),
  )
}

it('washes a pointer row while it is pressed, and fades its washes', async () => {
  renderWithProviders(
    <RowList label="Tunes" onAction={() => {}}>
      <Row id="1" textValue="Forked Deer" title="Forked Deer" />
    </RowList>,
    { density: 'pointer' },
  )
  const row = page.getByRole('row', { name: 'Forked Deer' })
  await expect.element(row).toBeVisible()
  const { transitionProperty } = getComputedStyle(row.element())
  expect(transitionProperty.split(', ')).toContain('background-color')
  pointer(row.element(), 'pointerdown', 'mouse')
  await expect.element(row).toHaveAttribute('data-pressed')
  await expect.poll(() => getComputedStyle(row.element()).backgroundColor).toBe(washColor())
  pointer(row.element(), 'pointerup', 'mouse')
  await expect.element(row).not.toHaveAttribute('data-pressed')
})

it('waits a beat before washing a pressed touch row, so a scroll never flashes it', async () => {
  renderWithProviders(
    <RowList label="Tunes" onAction={() => {}}>
      <Row id="1" textValue="Forked Deer" title="Forked Deer" />
    </RowList>,
    { density: 'touch' },
  )
  const row = page.getByRole('row', { name: 'Forked Deer' })
  await expect.element(row).toBeVisible()
  const content = row.element().querySelector<HTMLElement>('[style*="touch-action"]')!
  const wash = () => getComputedStyle(content, '::before')
  expect(Number(wash().opacity)).toBe(0)
  expect(wash().transitionDelay).toBe('0s')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    pointer(content, 'pointerdown', 'touch')
    await expect.element(row).toHaveAttribute('data-pressed')
    expect(wash().transitionDelay).toBe('0.075s')
    await expect.poll(() => Number(wash().opacity)).toBe(1)
    pointer(content, 'pointerup', 'touch')
    // React Aria ends a touch press on a timeout after the finger lifts.
    vi.runOnlyPendingTimers()
  } finally {
    vi.useRealTimers()
  }
  await expect.element(row).not.toHaveAttribute('data-pressed')
  expect(wash().transitionDelay).toBe('0s')
})
