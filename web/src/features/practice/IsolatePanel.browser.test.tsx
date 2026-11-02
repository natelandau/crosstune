import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../../test/render'
import { DEFAULT_ISOLATE, type IsolateSetting } from '../player/isolate/isolateSetting'
import { createOutlineFeed } from './isolateOutlineFeed'
import { IsolatePanel } from './IsolatePanel'
import { RESET } from './panel'
import {
  FREQUENCY_LOW,
  ISOLATE_EFFECT_LABEL,
  ISOLATE_PAUSES_ON_LOCK,
  ISOLATE_UNAVAILABLE,
  MONO_NOTICE,
  MUTE,
  SOLO,
  STEREO,
  STEREO_START,
} from './practiceCopy'

const NARROWED: IsolateSetting = {
  effect: 'mute',
  panStart: -50,
  panEnd: 0,
  lowHz: 200,
  highHz: 4000,
}

function Harness({
  initial,
  onChange,
  isMono = false,
  unavailable = false,
}: {
  initial: IsolateSetting
  onChange: (setting: IsolateSetting) => void
  isMono?: boolean
  unavailable?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <IsolatePanel
      value={value}
      isMono={isMono}
      unavailable={unavailable}
      lockNotice={false}
      outline={null}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

it('shows the stereo range for a stereo recording', async () => {
  renderWithProviders(<Harness initial={DEFAULT_ISOLATE} onChange={vi.fn()} />)
  await expect.element(page.getByRole('group', { name: STEREO })).toBeVisible()
  expect(page.getByText(MONO_NOTICE).query()).toBeNull()
})

it('leaves the stereo range out of a mono recording and says why', async () => {
  renderWithProviders(<Harness initial={DEFAULT_ISOLATE} onChange={vi.fn()} isMono />)
  await expect.element(page.getByText(MONO_NOTICE)).toBeVisible()
  expect(page.getByRole('group', { name: STEREO }).query()).toBeNull()
  expect(page.getByRole('slider', { name: STEREO_START }).query()).toBeNull()
  await expect.element(page.getByRole('slider', { name: FREQUENCY_LOW })).toBeVisible()
})

it('chooses Solo or Mute in a radio group', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness initial={DEFAULT_ISOLATE} onChange={onChange} />)
  const effect = page.getByRole('radiogroup', { name: ISOLATE_EFFECT_LABEL })
  await expect.element(effect.getByRole('radio', { name: SOLO })).toBeChecked()
  await effect.getByRole('radio', { name: MUTE }).click()
  await expect.element(effect.getByRole('radio', { name: MUTE })).toBeChecked()
  expect(onChange.mock.lastCall).toEqual([{ ...DEFAULT_ISOLATE, effect: 'mute' }])
})

it('resets to the default, and is off once there', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness initial={NARROWED} onChange={onChange} />)
  const reset = page.getByRole('button', { name: RESET })
  await expect.element(reset).not.toHaveAttribute('aria-disabled')
  await reset.click()
  expect(onChange.mock.lastCall).toEqual([DEFAULT_ISOLATE])
  await expect.element(reset).toHaveAttribute('aria-disabled', 'true')
  // A user click refuses an aria-disabled button, so the press goes to the element itself.
  ;(reset.element() as HTMLElement).click()
  expect(onChange).toHaveBeenCalledTimes(1)
})

it('keeps Reset off on a mono recording whose only change is pan', async () => {
  renderWithProviders(
    <Harness
      initial={{ ...DEFAULT_ISOLATE, panStart: -50, panEnd: 0 }}
      onChange={vi.fn()}
      isMono
    />,
  )
  await expect.element(page.getByText(MONO_NOTICE)).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: RESET }))
    .toHaveAttribute('aria-disabled', 'true')
})

it('shows one line in place of the controls while the stage cannot run', async () => {
  renderWithProviders(<Harness initial={NARROWED} onChange={vi.fn()} unavailable />)
  await expect
    .element(page.getByRole('status').filter({ hasText: ISOLATE_UNAVAILABLE }))
    .toBeVisible()
  expect(page.getByRole('radiogroup', { name: ISOLATE_EFFECT_LABEL }).query()).toBeNull()
  expect(page.getByRole('slider').all()).toHaveLength(0)
  expect(page.getByRole('button', { name: RESET }).query()).toBeNull()
})

it('says isolated playback pauses on lock only when asked to', async () => {
  const { rerender } = renderWithProviders(
    <IsolatePanel
      value={DEFAULT_ISOLATE}
      isMono={false}
      unavailable={false}
      lockNotice={false}
      outline={null}
      onChange={vi.fn()}
    />,
  )
  await expect.element(page.getByRole('group', { name: STEREO })).toBeVisible()
  expect(page.getByText(ISOLATE_PAUSES_ON_LOCK).query()).toBeNull()
  rerender(
    <IsolatePanel
      value={DEFAULT_ISOLATE}
      isMono={false}
      unavailable={false}
      lockNotice
      outline={null}
      onChange={vi.fn()}
    />,
  )
  await expect.element(page.getByText(ISOLATE_PAUSES_ON_LOCK)).toBeVisible()
})

it('draws the outline on canvases hidden from assistive technology', async () => {
  const feed = createOutlineFeed()
  renderWithProviders(
    <IsolatePanel
      value={DEFAULT_ISOLATE}
      isMono={false}
      unavailable={false}
      lockNotice={false}
      outline={feed}
      onChange={vi.fn()}
    />,
  )
  await expect.poll(() => document.querySelectorAll('canvas').length).toBe(2)
  expect(document.querySelectorAll('canvas[data-outline]').length).toBe(0)
  feed.push({ pan: new Float32Array(32).fill(0.5), freq: new Float32Array(48).fill(0.5) })
  await expect.poll(() => document.querySelectorAll('canvas[data-outline]').length).toBe(2)
  for (const canvas of document.querySelectorAll('canvas')) {
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
  }
})

it('keeps its status line mounted, empty and taking no height, while the stage runs', async () => {
  const { rerender } = renderWithProviders(
    <IsolatePanel
      value={DEFAULT_ISOLATE}
      isMono={false}
      unavailable={false}
      lockNotice={false}
      outline={null}
      onChange={vi.fn()}
    />,
  )
  await expect.element(page.getByRole('group', { name: STEREO })).toBeVisible()
  const line = document.querySelector<HTMLElement>('[role="status"]:empty')!
  expect(line.getBoundingClientRect().height).toBe(0)
  rerender(
    <IsolatePanel
      value={DEFAULT_ISOLATE}
      isMono={false}
      unavailable
      lockNotice={false}
      outline={null}
      onChange={vi.fn()}
    />,
  )
  await expect.poll(() => line.textContent).toBe(ISOLATE_UNAVAILABLE)
  expect(line.isConnected).toBe(true)
})
