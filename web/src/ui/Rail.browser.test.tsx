import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Capsule } from './Capsule'
import { Rail } from './Rail'

const CHIPS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']

/** A rail too narrow for its chips, so the overflow behavior is what is under test. */
function narrowRail(chosen?: string) {
  const { container } = render(
    <div style={{ width: 200 }}>
      <Rail label="Chips">
        {CHIPS.map((chip) => (
          <Capsule key={chip} pressed={chip === chosen} onPress={() => {}}>
            {chip}
          </Capsule>
        ))}
      </Rail>
    </div>,
  )
  const rail = container.querySelector('[role="group"]') as HTMLElement
  return { rail, chips: [...rail.querySelectorAll('button')] }
}

describe('Rail', () => {
  it('keeps every chip on one line when they do not fit', () => {
    const { rail, chips } = narrowRail()
    expect(rail.scrollWidth).toBeGreaterThan(rail.clientWidth)
    expect(new Set(chips.map((chip) => chip.offsetTop)).size).toBe(1)
  })

  it('fades the end while there is more to scroll to, and stops once there is not', async () => {
    const { rail } = narrowRail()
    expect(rail.dataset.fade).toBe('true')
    rail.scrollLeft = rail.scrollWidth - rail.clientWidth
    rail.dispatchEvent(new Event('scroll'))
    await expect.poll(() => rail.dataset.fade).toBeUndefined()
  })

  it('leaves a rail that fits unfaded', () => {
    const { container } = render(
      <Rail label="Chips">
        <Capsule onPress={() => {}}>One</Capsule>
      </Rail>,
    )
    expect((container.firstElementChild as HTMLElement).dataset.fade).toBeUndefined()
  })

  it('scrolls the chosen chip into view', () => {
    const { rail, chips } = narrowRail('Sixth')
    expect(rail.scrollLeft).toBeGreaterThan(0)
    const last = chips[chips.length - 1]!.getBoundingClientRect()
    const box = rail.getBoundingClientRect()
    expect(last.right).toBeLessThanOrEqual(box.right + 1)
    expect(last.left).toBeGreaterThanOrEqual(box.left - 1)
  })

  it('fades once the chips grow past the rail with no render behind it', async () => {
    const { container } = render(
      <div style={{ width: 400 }}>
        <Rail label="Chips">
          <Capsule onPress={() => {}}>One</Capsule>
          <Capsule onPress={() => {}}>Two</Capsule>
        </Rail>
      </div>,
    )
    const rail = container.querySelector('[role="group"]') as HTMLElement
    expect(rail.dataset.fade).toBeUndefined()
    // A text size change or a late web font widens the chips without React rendering the rail.
    for (const chip of rail.querySelectorAll('button')) chip.style.minWidth = '300px'
    await expect.poll(() => rail.dataset.fade).toBe('true')
  })

  it('fades once the rail narrows with no window resize behind it', async () => {
    const { container } = render(
      <div style={{ width: 1000 }}>
        <Rail label="Chips">
          {CHIPS.map((chip) => (
            <Capsule key={chip} onPress={() => {}}>
              {chip}
            </Capsule>
          ))}
        </Rail>
      </div>,
    )
    const rail = container.querySelector('[role="group"]') as HTMLElement
    expect(rail.dataset.fade).toBeUndefined()
    ;(container.firstElementChild as HTMLElement).style.width = '200px'
    await expect.poll(() => rail.dataset.fade).toBe('true')
  })

  it('drops the fade as soon as the chosen last chip is scrolled into view', () => {
    const { rail } = narrowRail('Sixth')
    expect(rail.dataset.fade).toBeUndefined()
  })

  it('leaves the rail at its start when the chosen chip is already in view', () => {
    const { rail } = narrowRail('First')
    expect(rail.scrollLeft).toBe(0)
  })
})
