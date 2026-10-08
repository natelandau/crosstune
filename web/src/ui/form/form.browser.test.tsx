import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { contrastRatio } from '../../test/contrast'
import { ANY } from '../filterCopy'
import { NOT_SET } from '../fieldCopy'
import { DAY_LABEL, MONTH_LABEL, NO_DATE } from '../partialDate'
import { renderWithProviders } from '../../test/render'
import { FieldRow } from './FieldRow'
import { Group } from './Group'
import { PartialDateField } from './PartialDateField'
import { Picker } from './Picker'
import { SuggestField } from './SuggestField'
import { Switch } from './Switch'

const OPTIONS = [
  { id: 'reel', label: 'reel' },
  { id: 'jig', label: 'jig' },
]

function PickerHost({
  start = null,
  onChange = () => {},
}: {
  start?: string | null
  onChange?: (id: string | null) => void
}) {
  const [value, setValue] = useState(start)
  return (
    <Group>
      <Picker
        label="Type"
        value={value}
        options={OPTIONS}
        emptyLabel={ANY}
        onChange={(id) => {
          setValue(id)
          onChange(id)
        }}
      />
    </Group>
  )
}

it('heads a group, and an error takes the footer’s place', async () => {
  const { rerender } = renderWithProviders(
    <Group header="Details" footer="Shown on the tune page.">
      <FieldRow label="Composer" value="Ed Haley" />
    </Group>,
  )
  await expect.element(page.getByRole('heading', { name: 'Details' })).toBeVisible()
  await expect.element(page.getByRole('region', { name: 'Details' })).toBeVisible()
  await expect.element(page.getByText('Shown on the tune page.')).toBeVisible()
  rerender(
    <Group header="Details" footer="Shown on the tune page." error="Too long.">
      <FieldRow label="Composer" value="Ed Haley" />
    </Group>,
  )
  await expect.element(page.getByRole('alert')).toHaveTextContent('Too long.')
  await expect.element(page.getByText('Shown on the tune page.')).not.toBeInTheDocument()
})

it('puts the label leading and the value trailing, eliding the value first', async () => {
  renderWithProviders(
    <div style={{ width: 200 }}>
      <FieldRow label="Composer" value={'Ed Haley '.repeat(10)} />
    </div>,
  )
  const label = page.getByText('Composer', { exact: true })
  const value = page.getByText(/Ed Haley Ed Haley/)
  await expect.element(label).toBeVisible()
  const labelBox = label.element().getBoundingClientRect()
  const valueBox = value.element().getBoundingClientRect()
  expect(labelBox.right).toBeLessThanOrEqual(valueBox.left)
  expect(value.element().scrollWidth).toBeGreaterThan(value.element().clientWidth)
  expect(label.element().scrollWidth).toBeLessThanOrEqual(label.element().clientWidth)
})

it('saves a switch on toggle', async () => {
  const onChange = vi.fn()
  function Host() {
    const [on, setOn] = useState(false)
    return (
      <Switch
        label="Only unheard"
        isSelected={on}
        onChange={(next) => {
          setOn(next)
          onChange(next)
        }}
      />
    )
  }
  renderWithProviders(<Host />)
  const toggle = page.getByRole('switch', { name: 'Only unheard' })
  await expect.element(toggle).not.toBeChecked()
  await page.getByText('Only unheard').click()
  await expect.element(toggle).toBeChecked()
  expect(onChange).toHaveBeenLastCalledWith(true)
})

it.each(['touch', 'pointer'] as const)(
  'wraps a long switch label and keeps the switch inside its row on %s',
  async (density) => {
    renderWithProviders(
      <div style={{ width: 320 }}>
        <Switch
          label="Download all recordings to this device"
          isSelected={false}
          onChange={() => {}}
        />
      </div>,
      { density },
    )
    const toggle = page.getByRole('switch', { name: 'Download all recordings to this device' })
    await expect.element(toggle).toBeInTheDocument()
    const row = toggle.element().closest('label')!
    const track = row.querySelector(':scope > span[aria-hidden]')!
    await expect
      .poll(() => track.getBoundingClientRect().right)
      .toBeLessThanOrEqual(row.getBoundingClientRect().right - 16)
  },
)

it.each([
  ['touch', 8],
  ['pointer', 5],
] as const)('pads a wrapped switch label off the row edges on %s', async (density, least) => {
  renderWithProviders(
    <div style={{ width: 200 }}>
      <Switch
        label="Download all recordings to this device"
        isSelected={false}
        onChange={() => {}}
      />
    </div>,
    { density },
  )
  const label = page.getByText('Download all recordings to this device')
  await expect.element(label).toBeVisible()
  const row = label.element().closest('label')!
  const lines = () => {
    const range = document.createRange()
    range.selectNodeContents(label.element())
    return [...range.getClientRects()]
  }
  await expect.poll(() => new Set(lines().map((line) => line.top)).size).toBeGreaterThan(1)
  const rows = row.getBoundingClientRect()
  expect(lines()[0]!.top - rows.top).toBeGreaterThanOrEqual(least)
  expect(rows.bottom - lines().at(-1)!.bottom).toBeGreaterThanOrEqual(least)
})

it('sizes a switch row as a picker row on pointer', async () => {
  renderWithProviders(
    <>
      <PickerHost />
      <Group>
        <Switch label="Only unheard" isSelected={false} onChange={() => {}} />
      </Group>
    </>,
    { density: 'pointer' },
  )
  const picker = page.getByRole('button', { name: /Type/ })
  const toggle = page.getByRole('switch', { name: 'Only unheard' })
  await expect.element(toggle).toBeInTheDocument()
  await expect.element(picker).toBeVisible()
  const row = () => toggle.element().closest('label')!.getBoundingClientRect().height
  await expect.poll(row).toBe(picker.element().getBoundingClientRect().height)
})

it('picks from a popover list box on pointer, the empty choice first', async () => {
  const onChange = vi.fn()
  renderWithProviders(<PickerHost onChange={onChange} />)
  const trigger = page.getByRole('button', { name: /Type/ })
  await expect.element(trigger).toHaveTextContent(ANY)
  await trigger.click()
  const list = page.getByRole('listbox')
  await expect.element(list).toBeVisible()
  expect(
    list
      .getByRole('option')
      .elements()
      .map((el) => el.textContent),
  ).toEqual([ANY, 'reel', 'jig'])
  await expect
    .element(list.getByRole('option', { name: ANY }))
    .toHaveAttribute('aria-selected', 'true')
  await list.getByRole('option', { name: 'jig' }).click()
  await expect.element(list).not.toBeInTheDocument()
  await expect.element(trigger).toHaveTextContent('jig')
  expect(onChange).toHaveBeenLastCalledWith('jig')
  await trigger.click()
  await page.getByRole('option', { name: ANY }).click()
  expect(onChange).toHaveBeenLastCalledWith(null)
})

it('picks from an action sheet on touch', async () => {
  const onChange = vi.fn()
  renderWithProviders(<PickerHost start="reel" onChange={onChange} />, { density: 'touch' })
  const trigger = page.getByRole('button', { name: /Type/ })
  await expect.element(trigger).toHaveTextContent('reel')
  await trigger.click()
  const sheet = page.getByRole('dialog', { name: 'Type' })
  await expect.element(sheet).toBeVisible()
  await expect
    .element(sheet.getByRole('menuitemradio', { name: 'reel' }))
    .toHaveAttribute('aria-checked', 'true')
  await sheet.getByRole('menuitemradio', { name: 'jig' }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.element(trigger).toHaveTextContent('jig')
  expect(onChange).toHaveBeenLastCalledWith('jig')
})

it.each(['light', 'dark'] as const)(
  'draws the switch in %s with a track and thumb that read',
  async (scheme) => {
    function Host() {
      const [on, setOn] = useState(false)
      return (
        <Group>
          <Switch label="Only unheard" isSelected={on} onChange={setOn} />
        </Group>
      )
    }
    renderWithProviders(<Host />, { scheme })
    const label = page.getByText('Only unheard')
    await expect.element(label).toBeVisible()
    const track = label.element().nextElementSibling!
    const thumb = track.firstElementChild!
    const card = track.closest('section')!.firstElementChild!
    const style = (el: Element) => getComputedStyle(el)
    const bg = (el: Element) => style(el).backgroundColor
    // Off, the track is a light fill whose edge and thumb carry the contrast; on, the slate
    // track itself does. Each state's outline reads against the row and the ground.
    const edge = (on: boolean) => (on ? bg(track) : style(track).borderTopColor)
    const pairs = (on: boolean) => [
      contrastRatio(edge(on), bg(card)),
      contrastRatio(edge(on), bg(document.body)),
      contrastRatio(bg(thumb), bg(track)),
    ]
    expect(Number.parseFloat(style(track).borderTopWidth)).toBeGreaterThanOrEqual(1)
    for (const ratio of pairs(false)) expect(ratio).toBeGreaterThanOrEqual(3)
    const off = bg(track)
    await label.click()
    await expect.element(page.getByRole('switch')).toBeChecked()
    await expect.poll(() => Math.min(...pairs(true))).toBeGreaterThanOrEqual(3)
    // On and off differ in lightness, not only in the thumb's place.
    expect(contrastRatio(bg(track), off)).toBeGreaterThanOrEqual(3)
  },
)

it.each(['pointer', 'touch'] as const)(
  'keeps a value no option holds as its own choice on %s, never the empty one',
  async (density) => {
    renderWithProviders(<PickerHost start="hornpipe" />, { density })
    const trigger = page.getByRole('button', { name: /Type/ })
    await expect.element(trigger).toHaveTextContent('hornpipe')
    await trigger.click()
    const choice = page.getByRole(density === 'pointer' ? 'option' : 'menuitemradio', {
      name: 'hornpipe',
    })
    await expect
      .element(choice)
      .toHaveAttribute(density === 'pointer' ? 'aria-selected' : 'aria-checked', 'true')
  },
)

it('focuses the chosen option when its action sheet opens on touch', async () => {
  renderWithProviders(<PickerHost start="jig" />, { density: 'touch' })
  await page.getByRole('button', { name: /Type/ }).click()
  await expect.element(page.getByRole('menuitemradio', { name: 'jig' })).toHaveFocus()
})

it('opens from a press on its label on pointer', async () => {
  renderWithProviders(<PickerHost />)
  // Forced, since the button's hit area lies over the label by design and the press lands on
  // it, which an actionability check would refuse.
  await page.getByText('Type', { exact: true }).click({ force: true })
  await expect.element(page.getByRole('listbox')).toBeVisible()
})

it('works from the keyboard on pointer', async () => {
  const onChange = vi.fn()
  renderWithProviders(<PickerHost start="reel" onChange={onChange} />)
  const trigger = page.getByRole('button', { name: /Type/ })
  await userEvent.keyboard('{Tab}')
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(page.getByRole('option', { name: 'reel' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(onChange).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('option', { name: 'reel' })).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(page.getByRole('option', { name: ANY })).toHaveFocus()
  await userEvent.keyboard('j')
  await expect.element(page.getByRole('option', { name: 'jig' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect.element(trigger).toHaveTextContent('jig')
  expect(onChange).toHaveBeenLastCalledWith('jig')
})

it('works from the keyboard on touch', async () => {
  const onChange = vi.fn()
  renderWithProviders(<PickerHost start="reel" onChange={onChange} />, { density: 'touch' })
  const trigger = page.getByRole('button', { name: /Type/ })
  const sheet = page.getByRole('dialog', { name: 'Type' })
  await userEvent.keyboard('{Tab}')
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(sheet).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(onChange).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  // The action sheet opens on the chosen value, so the arrows work at once.
  await expect.element(sheet.getByRole('menuitemradio', { name: 'reel' })).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(sheet.getByRole('menuitemradio', { name: 'jig' })).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}{ArrowUp}')
  await expect.element(sheet.getByRole('menuitemradio', { name: ANY })).toHaveFocus()
  await userEvent.keyboard('j')
  await expect.element(sheet.getByRole('menuitemradio', { name: 'jig' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(onChange).toHaveBeenLastCalledWith('jig')
})

it.each(['pointer', 'touch'] as const)(
  'draws a chosen value in ink and the empty choice in secondary on %s',
  async (density) => {
    renderWithProviders(
      <>
        <PickerHost start="reel" />
        <PickerHost />
      </>,
      { density },
    )
    // The value inside each trigger, not the hidden native options pointer adds.
    const ink = (text: string) => () => {
      const value = page
        .getByRole('button', { name: /Type/ })
        .elements()
        .flatMap((button) => [...button.querySelectorAll('span')])
        .find((span) => span.childElementCount === 0 && span.textContent === text)
      return value ? getComputedStyle(value).color : null
    }
    const root = getComputedStyle(document.documentElement)
    const probe = (token: string) => {
      const span = document.createElement('span')
      span.style.color = root.getPropertyValue(token).trim()
      document.body.append(span)
      const color = getComputedStyle(span).color
      span.remove()
      return color
    }
    await expect.poll(ink('reel')).toBe(probe('--ink'))
    await expect.poll(ink(ANY)).toBe(probe('--ink-2'))
  },
)

it('rings a refused date part in the danger color on touch', async () => {
  renderWithProviders(
    <Group>
      <PartialDateField
        value={{ ...NO_DATE, year: '2019' }}
        onChange={() => {}}
        refusedPart="month"
      />
    </Group>,
    { density: 'touch' },
  )
  const month = page.getByRole('button', { name: new RegExp(`^${MONTH_LABEL}`) })
  const day = page.getByRole('button', { name: new RegExp(`^${DAY_LABEL}`) })
  const ring = (part: typeof month) => () => getComputedStyle(part.element()).boxShadow
  await expect.element(month).toHaveAttribute('data-invalid', 'true')
  await expect.poll(ring(month)).not.toBe('none')
  expect(ring(day)()).toBe('none')
})

it.each([
  ['a value', 'reel', false],
  ['Not set', '', true],
])('selects a suggested field on focus only while it shows Not set: %s', async (_, value, all) => {
  renderWithProviders(
    <Group>
      <SuggestField label="Type" value={value} suggestions={['reel', 'jig']} onChange={() => {}} />
    </Group>,
  )
  const input = page.getByRole('combobox', { name: 'Type' })
  await expect.element(input).toHaveValue(value || NOT_SET)
  await input.click()
  await expect.element(input).toHaveFocus()
  const field = input.element() as HTMLInputElement
  const selected = () => (field.selectionEnd ?? 0) - (field.selectionStart ?? 0)
  await expect.poll(selected).toBe(all ? NOT_SET.length : 0)
})

it.each([
  ['pointer', 'option'],
  ['touch', 'menuitemradio'],
] as const)(
  'reports a pick of the chosen value, never a dismissal, on %s',
  async (density, role) => {
    const onChoose = vi.fn()
    renderWithProviders(
      <Group>
        <Picker
          label="Type"
          value="reel"
          options={OPTIONS}
          emptyLabel={ANY}
          onChange={() => {}}
          onChoose={onChoose}
        />
      </Group>,
      { density },
    )
    const trigger = page.getByRole('button', { name: /Type/ })
    const reel = page.getByRole(role, { name: 'reel' })
    await trigger.click()
    await expect.element(reel).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(reel).not.toBeInTheDocument()
    await trigger.click()
    await reel.click()
    await expect.poll(() => onChoose).toHaveBeenCalledOnce()
    // From the keyboard too: the list opens on the chosen value.
    await trigger.click()
    await expect.element(reel).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(reel).not.toBeInTheDocument()
    await expect.poll(() => onChoose).toHaveBeenCalledTimes(2)
  },
)

it('counts a screen reader pick of the shown value, never a typeahead Space, on pointer', async () => {
  const onChoose = vi.fn()
  const onChange = vi.fn()
  renderWithProviders(
    <Group>
      <Picker
        label="Type"
        value="reel"
        options={[...OPTIONS, { id: 'jig two', label: 'jig two' }]}
        emptyLabel={ANY}
        onChange={onChange}
        onChoose={onChoose}
      />
    </Group>,
  )
  const trigger = page.getByRole('button', { name: /Type/ })
  const reel = page.getByRole('option', { name: 'reel' })
  await trigger.click()
  await expect.element(reel).toHaveFocus()
  // Typing past a word boundary sends a Space to the open list, which only narrows it.
  await userEvent.keyboard('jig ')
  await expect.element(page.getByRole('option', { name: 'jig two' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(reel).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  // A click with no pointerdown before it is a screen reader's activation.
  await trigger.click()
  ;(reel.element() as HTMLElement).click()
  await expect.element(reel).not.toBeInTheDocument()
  // Exactly one call, so the Escape above counted none.
  await expect.poll(() => onChoose.mock.calls.length).toBe(1)
  expect(onChange).not.toHaveBeenCalled()
})

it('never counts Escape as a pick while a pointer is held on an option', async () => {
  const onChoose = vi.fn()
  renderWithProviders(
    <Group>
      <Picker
        label="Type"
        value="reel"
        options={OPTIONS}
        emptyLabel={ANY}
        onChange={() => {}}
        onChoose={onChoose}
      />
    </Group>,
  )
  const trigger = page.getByRole('button', { name: /Type/ })
  const reel = page.getByRole('option', { name: 'reel' })
  await trigger.click()
  await expect.element(reel).toBeVisible()
  // A press that has started and not ended.
  ;(reel.element() as HTMLElement).dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      width: 1,
      height: 1,
    }),
  )
  await userEvent.keyboard('{Escape}')
  await expect.element(reel).not.toBeInTheDocument()
  await trigger.click()
  await reel.click()
  // Exactly one call, so the Escape above counted none.
  await expect.poll(() => onChoose.mock.calls.length).toBe(1)
})
