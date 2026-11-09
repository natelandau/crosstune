import { useState } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { contrastRatio } from '../../test/contrast'
import { ANY } from '../filterCopy'
import { DAY_LABEL, MONTH_LABEL, NO_DATE } from '../partialDate'
import { holdMotionClock, motionFrames } from '../../test/motionClock'
import { renderWithProviders } from '../../test/render'
import { Sheet } from '../Sheet'
import { FieldRow } from './FieldRow'
import { Group } from './Group'
import { PartialDateField } from './PartialDateField'
import { Picker } from './Picker'
import { SuggestField } from './SuggestField'
import { Switch } from './Switch'
import { Checkbox } from './Checkbox'
import { Capsule } from '../Capsule'
import { Stepper } from '../Stepper'
import { ButtonRow } from './ButtonRow'

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
    // In either state the track reads against the row and the page, and the thumb against
    // the track. On, the thumb holds a check, so the state never rests on the thumb's place alone.
    const pairs = () => [
      contrastRatio(bg(track), bg(card)),
      contrastRatio(bg(track), bg(document.body)),
      contrastRatio(bg(thumb), bg(track)),
    ]
    const check = () => Number(style(thumb.firstElementChild!).opacity)
    await expect.poll(() => Math.min(...pairs())).toBeGreaterThanOrEqual(3)
    expect(check()).toBe(0)
    await label.click()
    await expect.element(page.getByRole('switch')).toBeChecked()
    // Measured at rest, off the hover's mixed track.
    await userEvent.unhover(label)
    await expect.poll(() => Math.min(...pairs())).toBeGreaterThanOrEqual(3)
    await expect.poll(check).toBe(1)
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
  'draws a chosen value in primary text and the empty choice in secondary text on %s',
  async (density) => {
    renderWithProviders(
      <>
        <PickerHost start="reel" />
        <PickerHost />
      </>,
      { density },
    )
    // The value inside each trigger, not the hidden native options pointer adds.
    const textColor = (text: string) => () => {
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
    await expect.poll(textColor('reel')).toBe(probe('--text-primary'))
    await expect.poll(textColor(ANY)).toBe(probe('--text-secondary'))
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

function SuggestHost({
  start = '',
  keep = false,
  onChange = () => {},
}: {
  start?: string
  /** Starts kept, over values that disagree. */
  keep?: boolean
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useState(start)
  const [kept, setKept] = useState(keep)
  return (
    <Group>
      <SuggestField
        label="Type"
        value={value}
        suggestions={['reel', 'jig', 'slip jig']}
        maxLength={12}
        keep={keep ? { label: 'Mixed', kept, onKeep: () => setKept(true) } : undefined}
        onChange={(next) => {
          setKept(false)
          setValue(next)
          onChange(next)
        }}
      />
    </Group>
  )
}

it('leaves an empty suggested field empty, with no placeholder', async () => {
  renderWithProviders(<SuggestHost />)
  const input = page.getByRole('combobox', { name: 'Type' })
  await expect.element(input).toHaveValue('')
  expect(input.element().getAttribute('placeholder') ?? '').toBe('')
})

it('takes typed text as the value without a pick, capped at its limit', async () => {
  const onChange = vi.fn()
  renderWithProviders(<SuggestHost onChange={onChange} />)
  const input = page.getByRole('combobox', { name: 'Type' })
  await expect.element(input).toHaveAttribute('maxlength', '12')
  await input.click()
  await userEvent.keyboard('hornpipe')
  await expect.element(input).toHaveValue('hornpipe')
  await expect.poll(() => onChange.mock.lastCall).toEqual(['hornpipe'])
  await userEvent.keyboard('{Tab}')
  await expect.element(input).not.toHaveFocus()
  await expect.element(input).toHaveValue('hornpipe')
})

it('narrows the suggestions as the musician types, and sets one on a pick', async () => {
  const onChange = vi.fn()
  renderWithProviders(<SuggestHost onChange={onChange} />)
  const input = page.getByRole('combobox', { name: 'Type' })
  await input.click()
  await expect.element(page.getByRole('option', { name: 'reel' })).toBeVisible()
  await userEvent.keyboard('ji')
  await expect.element(page.getByRole('option', { name: 'reel' })).not.toBeInTheDocument()
  await page.getByRole('option', { name: 'slip jig' }).click()
  await expect.element(input).toHaveValue('slip jig')
  await expect
    .element(page.getByRole('option', { name: 'jig', exact: true }))
    .not.toBeInTheDocument()
  await expect.poll(() => onChange.mock.lastCall).toEqual(['slip jig'])
})

it('picks a suggestion from the keyboard', async () => {
  renderWithProviders(<SuggestHost />)
  const input = page.getByRole('combobox', { name: 'Type' })
  await input.click()
  await userEvent.keyboard('jig')
  await expect.element(page.getByRole('option', { name: 'slip jig' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  await expect.element(input).toHaveValue('slip jig')
})

it('empties the field when its text is deleted', async () => {
  const onChange = vi.fn()
  renderWithProviders(<SuggestHost start="reel" onChange={onChange} />)
  const input = page.getByRole('combobox', { name: 'Type' })
  await expect.element(input).toHaveValue('reel')
  await input.clear()
  await expect.element(input).toHaveValue('')
  await expect.poll(() => onChange.mock.lastCall).toEqual([''])
})

it('shows a kept row empty under its keep label, and restores it from Keep', async () => {
  const onChange = vi.fn()
  renderWithProviders(<SuggestHost keep onChange={onChange} />)
  const input = page.getByRole('combobox', { name: 'Type' })
  await expect.element(input).toHaveValue('')
  await expect.element(input).toHaveAttribute('placeholder', 'Mixed')
  await input.click()
  // A kept row offers no Keep: it already is.
  await expect.element(page.getByRole('option', { name: 'reel' })).toBeVisible()
  await expect.element(page.getByRole('option', { name: 'Mixed' })).not.toBeInTheDocument()
  await userEvent.keyboard('hornpipe')
  await expect.element(input).toHaveValue('hornpipe')
  await expect.element(input).not.toHaveAttribute('placeholder')
  await input.clear()
  await expect.poll(() => onChange.mock.lastCall).toEqual([''])
  // Cleared, the row is touched and empty rather than kept.
  await expect.element(input).not.toHaveAttribute('placeholder')
  await page.getByRole('option', { name: 'Mixed' }).click()
  await expect.element(input).toHaveValue('')
  await expect.element(input).toHaveAttribute('placeholder', 'Mixed')
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

it('heads a group one level under the page title', async () => {
  renderWithProviders(
    <Group header="Recording">
      <Switch label="Save location" isSelected={false} onChange={() => {}} />
    </Group>,
  )
  await expect.element(page.getByRole('heading', { name: 'Recording', level: 2 })).toBeVisible()
})

it.each(['touch', 'pointer'] as const)(
  'heads a group in a %s sheet one level under its title',
  async (density) => {
    renderWithProviders(
      <Sheet isOpen onOpenChange={() => {}} title="Edit tune">
        <Group header="Details">
          <Switch label="Crooked" isSelected={false} onChange={() => {}} />
        </Group>
      </Sheet>,
      { density },
    )
    await expect.element(page.getByRole('heading', { name: 'Edit tune', level: 2 })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Details', level: 3 })).toBeVisible()
  },
)

it.each([
  ['pointer', 24, 40],
  ['touch', 32, 52],
] as const)('sizes the switch track from the compact height on %s', async (density, h, w) => {
  renderWithProviders(<Switch label="Only unheard" isSelected={false} onChange={() => {}} />, {
    density,
  })
  const toggle = page.getByRole('switch', { name: 'Only unheard' })
  await expect.element(toggle).toBeInTheDocument()
  const track = toggle.element().closest('label')!.querySelector('.switch-track')!
  await expect.poll(() => track.getBoundingClientRect().height).toBe(h)
  expect(track.getBoundingClientRect().width).toBe(w)
})

it.each([
  ['pointer', 24],
  ['touch', 32],
] as const)('sizes the checkbox ring from the compact height on %s', async (density, size) => {
  renderWithProviders(<Checkbox label="Include Reel" isSelected={false} onChange={() => {}} />, {
    density,
  })
  const ring = page
    .getByRole('checkbox', { name: 'Include Reel' })
    .element()
    .closest('label')!
    .querySelector('.check-mark')!
  await expect.poll(() => ring.getBoundingClientRect().height).toBe(size)
  expect(ring.getBoundingClientRect().width).toBe(size)
})

it.each(['pointer', 'touch'] as const)(
  'draws the checkbox hover halo well past its ring on %s',
  async (density) => {
    renderWithProviders(<Checkbox label="Include Reel" isSelected={false} onChange={() => {}} />, {
      density,
    })
    const box = page.getByRole('checkbox', { name: 'Include Reel' }).element().closest('label')!
    const ring = box.querySelector('.check-mark')!
    await expect.poll(() => ring.getBoundingClientRect().width).toBeGreaterThan(0)
    const halo = parseFloat(getComputedStyle(box, '::before').width)
    expect(halo - ring.getBoundingClientRect().width).toBeGreaterThanOrEqual(12)
  },
)

it.each(['pointer', 'touch'] as const)(
  'a switch, a checkbox, and a chip line up in rows on %s',
  async (density) => {
    renderWithProviders(
      <Group>
        <Switch label="Only unheard" isSelected={false} onChange={() => {}} />
        <FieldRow label="Include">
          <Checkbox label="Include Reel" isSelected={false} onChange={() => {}} />
        </FieldRow>
        <FieldRow label="Key">
          <Capsule label="D" />
        </FieldRow>
      </Group>,
      { density },
    )
    const sw = page.getByRole('switch', { name: 'Only unheard' })
    await expect.element(sw).toBeInTheDocument()
    // Each control against the whole row it sits in, the card's child that holds it.
    const rowOf = (control: Element) =>
      [...control.closest('section')!.lastElementChild!.children].find((row) =>
        row.contains(control),
      )!
    const track = sw.element().closest('label')!.querySelector('.switch-track')!
    const mark = page
      .getByRole('checkbox', { name: 'Include Reel' })
      .element()
      .closest('label')!
      .querySelector('.check-mark')!
    const chip = page.getByRole('button', { name: 'D' }).element()
    const cases = [track, mark, chip].map((control) => [control, rowOf(control)] as const)
    const box = (e: Element) => e.getBoundingClientRect()
    await expect.poll(() => new Set(cases.map(([c]) => box(c).height)).size).toBe(1)
    for (const [control, row] of cases) {
      expect(box(control).top + box(control).height / 2).toBeCloseTo(
        box(row).top + box(row).height / 2,
        0,
      )
    }
  },
)

it('draws a hairline between rows and none above the first', async () => {
  renderWithProviders(
    <Group>
      <FieldRow label="Composer" value="Ed Haley" />
      <PartialDateField value={NO_DATE} onChange={() => {}} />
      <Switch label="Only unheard" isSelected={false} onChange={() => {}} />
    </Group>,
  )
  const composer = page.getByText('Composer', { exact: true })
  await expect.element(composer).toBeVisible()
  const card = composer.element().closest('section')!.lastElementChild!
  const rows = [...card.children]
    .flatMap((child) =>
      getComputedStyle(child).display === 'contents' ? [...child.children] : [child],
    )
    // A picker leaves an unrendered template beside its row.
    .filter((row) => getComputedStyle(row).display !== 'none')
  const hairline = (row: Element) => {
    const line = getComputedStyle(row, '::before')
    return line.content !== 'none' && line.height === '1px'
  }
  // The composer, the date's year, month, day, and Clear date, then the switch.
  expect(rows).toHaveLength(6)
  expect(hairline(rows[0]!)).toBe(false)
  expect(rows.slice(1).every(hairline)).toBe(true)
  // Inset to the text, so the line starts where the label does.
  expect(getComputedStyle(rows[1]!, '::before').left).toBe('16px')
})

it.each(['pointer', 'touch'] as const)(
  'draws no hairline above a picker that leads its group, and rounds its top on %s',
  async (density) => {
    renderWithProviders(
      <Group>
        <Picker label="Type" value={null} options={OPTIONS} emptyLabel={ANY} onChange={() => {}} />
        <FieldRow label="Composer" value="Ed Haley" />
      </Group>,
      { density },
    )
    const composer = page.getByText('Composer', { exact: true })
    await expect.element(composer).toBeVisible()
    const card = composer.element().closest('section')!.lastElementChild!
    const rows = [...card.children].filter((row) => getComputedStyle(row).display !== 'none')
    const line = (row: Element) => getComputedStyle(row, '::before').content
    expect(rows).toHaveLength(2)
    expect(line(rows[0]!)).toBe('none')
    expect(line(rows[1]!)).not.toBe('none')
    // The hover fill keeps the card's corners.
    await page.getByRole('button', { name: /Type/ }).hover()
    expect(getComputedStyle(rows[0]!).borderTopLeftRadius).toBe('8px')
    expect(getComputedStyle(rows[0]!).borderTopRightRadius).toBe('8px')
  },
)

/** A group's rendered rows, past the unrendered template a pointer picker leaves. */
function rowsOf(inside: Element): Element[] {
  const card = inside.closest('section')!.lastElementChild!
  return [...card.children].filter((row) => getComputedStyle(row).display !== 'none')
}

const corners = (row: Element) => {
  const style = getComputedStyle(row)
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]
}

it('rounds all four corners of a group with one row', async () => {
  renderWithProviders(
    <Group>
      <FieldRow label="Composer" value="Ed Haley" />
    </Group>,
  )
  const composer = page.getByText('Composer', { exact: true })
  await expect.element(composer).toBeVisible()
  const [row] = rowsOf(composer.element())
  expect(corners(row!)).toEqual(['8px', '8px', '8px', '8px'])
})

it('rounds the card corners on rows inside a wrapper that leads and ends its group', async () => {
  renderWithProviders(
    <Group>
      <PartialDateField value={NO_DATE} onChange={() => {}} />
    </Group>,
  )
  const month = page.getByText(MONTH_LABEL, { exact: true })
  await expect.element(month).toBeVisible()
  const card = month.element().closest('section')!.lastElementChild!
  const rows = [...card.children]
    .flatMap((child) =>
      getComputedStyle(child).display === 'contents' ? [...child.children] : [child],
    )
    .filter((row) => getComputedStyle(row).display !== 'none')
  expect(rows.length).toBeGreaterThan(1)
  await expect.poll(() => corners(rows[0]!).slice(0, 2)).toEqual(['8px', '8px'])
  expect(corners(rows.at(-1)!).slice(2)).toEqual(['8px', '8px'])
})

it.each(['pointer', 'touch'] as const)(
  'draws no hairline above a suggested field that leads its group on %s',
  async (density) => {
    renderWithProviders(
      <Group>
        <SuggestField label="Type" value="" suggestions={['reel']} onChange={() => {}} />
        <FieldRow label="Composer" value="Ed Haley" />
      </Group>,
      { density },
    )
    const composer = page.getByText('Composer', { exact: true })
    await expect.element(composer).toBeVisible()
    const rows = rowsOf(composer.element())
    expect(rows).toHaveLength(2)
    expect(getComputedStyle(rows[0]!, '::before').content).toBe('none')
    expect(getComputedStyle(rows[1]!, '::before').content).not.toBe('none')
    expect(corners(rows[0]!).slice(0, 2)).toEqual(['8px', '8px'])
  },
)

it.each(['pointer', 'touch'] as const)(
  'keeps the card corners on a refused picker first and last in its group on %s',
  async (density) => {
    renderWithProviders(
      <Group>
        <Picker
          label="Type"
          value={null}
          options={OPTIONS}
          emptyLabel={ANY}
          isInvalid
          onChange={() => {}}
        />
        <FieldRow label="Composer" value="Ed Haley" />
        <Picker
          label="Key"
          value={null}
          options={OPTIONS}
          emptyLabel={ANY}
          isInvalid
          onChange={() => {}}
        />
      </Group>,
      { density },
    )
    const composer = page.getByText('Composer', { exact: true })
    await expect.element(composer).toBeVisible()
    const rows = rowsOf(composer.element())
    expect(rows).toHaveLength(3)
    expect(corners(rows[0]!).slice(0, 2)).toEqual(['8px', '8px'])
    expect(corners(rows[2]!).slice(2)).toEqual(['8px', '8px'])
  },
)

function Members({ names }: { names: string[] }) {
  return (
    <Group animateRows>
      {names.map((name) => (
        <FieldRow key={name} label={name} />
      ))}
    </Group>
  )
}

it('opens a new row and closes a removed one', async () => {
  holdMotionClock()
  const { rerender } = renderWithProviders(<Members names={['Member 1']} />)
  await expect.element(page.getByText('Member 1')).toBeVisible()
  rerender(<Members names={['Member 1', 'Member 2']} />)
  const added = () => page.getByText('Member 2').element().parentElement!.parentElement!
  await expect.element(page.getByText('Member 2')).toBeInTheDocument()
  expect(added().getBoundingClientRect().height).toBe(0)
  motionFrames(100)
  const partway = added().getBoundingClientRect().height
  expect(partway).toBeGreaterThan(0)
  expect(partway).toBeLessThan(40)
  motionFrames(500)
  expect(added().getBoundingClientRect().height).toBe(40)
  rerender(<Members names={['Member 1']} />)
  motionFrames(140)
  expect(page.getByText('Member 2').query()).not.toBeNull()
  motionFrames(10)
  await expect.element(page.getByText('Member 2')).not.toBeInTheDocument()
})

it('keeps compact controls centered in rows at the large text size', async () => {
  const root = document.documentElement
  root.dataset.textSize = 'large'
  onTestFinished(() => void delete root.dataset.textSize)
  renderWithProviders(
    <Group>
      <Switch label="Only unheard" isSelected={false} onChange={() => {}} />
      <FieldRow label="Transpose">
        <Stepper
          label="Semitones"
          value={0}
          min={-12}
          max={12}
          format={String}
          decrementLabel="Down"
          incrementLabel="Up"
          onChange={() => {}}
        />
      </FieldRow>
      <ButtonRow
        description="Save a copy of everything to a file."
        button={{ label: 'Export', onPress: () => {} }}
      />
    </Group>,
  )
  const toggle = page.getByRole('switch', { name: 'Only unheard' })
  await expect.element(toggle).toBeInTheDocument()
  const card = toggle.element().closest('section')!.lastElementChild!
  const rowOf = (el: Element) => {
    let row = el
    while (row.parentElement !== card) row = row.parentElement!
    return row
  }
  const controls = [
    toggle.element().closest('label')!.querySelector('.switch-track')!,
    page.getByRole('group', { name: 'Semitones' }).element(),
    page.getByRole('button', { name: 'Export' }).element(),
  ]
  const box = (e: Element) => e.getBoundingClientRect()
  const center = (e: Element) => box(e).top + box(e).height / 2
  await expect.poll(() => new Set(controls.map((c) => box(c).height)).size).toBe(1)
  // The compact height scales with the text size.
  expect(box(controls[0]!).height).toBeGreaterThan(24)
  for (const control of controls) {
    expect(center(control)).toBeCloseTo(center(rowOf(control)), 0)
  }
})
