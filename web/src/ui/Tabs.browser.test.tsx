import { Activity, LayoutGrid, Settings } from 'lucide-react'
import { MotionConfig } from 'motion/react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { pollStill } from '../test/stillPoll'
import { InOverlay } from './inOverlay'
import { Tabs, type TabItem } from './Tabs'

type Id = 'overview' | 'activity' | 'settings'

const TABS: readonly TabItem<Id>[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function Harness({
  tabs = TABS,
  container,
}: {
  tabs?: readonly TabItem<Id>[]
  container?: 'card' | 'page'
}) {
  const [selected, setSelected] = useState<Id>('overview')
  return (
    <Tabs
      label="Sections"
      tabs={tabs}
      selected={selected}
      onChange={setSelected}
      container={container}
    >
      {(id) => <p>{id} content</p>}
    </Tabs>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

const tab = (name: string) => page.getByRole('tab', { name, exact: true })

it('names each tab and its panel', async () => {
  renderWithProviders(<Harness />)
  await expect.element(page.getByRole('tablist', { name: 'Sections' })).toBeVisible()
  for (const { label } of TABS) await expect.element(tab(label)).toBeVisible()
  await expect.element(tab('Overview')).toHaveAttribute('aria-selected', 'true')
  await expect.element(page.getByRole('tabpanel')).toHaveTextContent('overview content')
  await tab('Activity').click()
  await expect.element(page.getByRole('tabpanel')).toHaveTextContent('activity content')
})

it('stacks icon over label on touch and sets them side by side on pointer', async () => {
  const parts = () => {
    const element = tab('Overview').element()
    return {
      icon: element.querySelector('svg')!.getBoundingClientRect(),
      text: [...element.querySelectorAll('span')]
        .find((span) => span.textContent === 'Overview')!
        .getBoundingClientRect(),
    }
  }
  const touch = renderWithProviders(<Harness />, { density: 'touch' })
  await expect.element(tab('Overview')).toBeVisible()
  await expect.poll(() => parts().text.top).toBeGreaterThanOrEqual(parts().icon.bottom)
  touch.unmount()

  renderWithProviders(<Harness />, { density: 'pointer' })
  await expect.element(tab('Overview')).toBeVisible()
  await expect.poll(() => parts().text.left).toBeGreaterThanOrEqual(parts().icon.right)
  expect(parts().text.top).toBeLessThan(parts().icon.bottom)
})

it('stacks icon over label on pointer inside a sheet or popover', async () => {
  renderWithProviders(
    <InOverlay value>
      <Harness container="page" />
    </InOverlay>,
    { density: 'pointer' },
  )
  await expect.element(tab('Overview')).toBeVisible()
  const element = tab('Overview').element()
  const icon = element.querySelector('svg')!.getBoundingClientRect()
  const text = [...element.querySelectorAll('span')]
    .find((span) => span.textContent === 'Overview')!
    .getBoundingClientRect()
  expect(text.top).toBeGreaterThanOrEqual(icon.bottom)
})

it('slides the panel in from the side of the new tab', async () => {
  renderWithProviders(<Harness />)
  await expect.element(tab('Overview')).toBeVisible()
  vi.useFakeTimers()
  const start = () => {
    const [animation] = page.getByRole('tabpanel').element().getAnimations()
    const translate = (animation?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]
      ?.translate
    return parseFloat(String(translate))
  }
  await userEvent.click(tab('Settings'), { force: true })
  await pollStill(start).toBeGreaterThan(0)
  await userEvent.click(tab('Overview'), { force: true })
  await pollStill(start).toBeLessThan(0)
})

it('skips a disabled tab with the arrow keys', async () => {
  const tabs = TABS.map((t) => (t.id === 'activity' ? { ...t, isDisabled: true } : t))
  renderWithProviders(<Harness tabs={tabs} />)
  await expect.element(tab('Overview')).toBeVisible()
  tab('Overview').element().focus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(tab('Settings')).toHaveFocus()
})

it('fades the panel without moving it under reduced motion', async () => {
  renderWithProviders(
    <MotionConfig reducedMotion="always">
      <Harness />
    </MotionConfig>,
  )
  await expect.element(tab('Overview')).toBeVisible()
  vi.useFakeTimers()
  const keyframe = () => {
    const [animation] = page.getByRole('tabpanel').element().getAnimations()
    return (animation?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]
  }
  await userEvent.click(tab('Settings'), { force: true })
  await pollStill(() => keyframe()?.opacity).toBe('0')
  expect(keyframe()?.translate).toMatch(/^0px/)
})
