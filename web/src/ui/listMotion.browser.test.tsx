import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { Row } from './Row'
import { RowList } from './RowList'

const TITLES = ['Forked Deer', 'Angeline the Baker', 'Cluck Old Hen', "Soldier's Joy"]

type Edit = (update: (titles: string[]) => string[]) => void

function Tunes({ onEdit }: { onEdit: (edit: Edit) => void }) {
  const [titles, setTitles] = useState(TITLES)
  useEffect(() => onEdit(setTitles), [onEdit])
  return (
    <RowList label="Tunes">
      {titles.map((title) => (
        <Row key={title} id={title} textValue={title} title={title} />
      ))}
    </RowList>
  )
}

/** Mounts the list, then returns a change that lands in the page before any frame can run. */
async function mounted(): Promise<(update: (titles: string[]) => string[]) => Promise<void>> {
  let edit: Edit | null = null
  renderWithProviders(<Tunes onEdit={(next) => (edit = next)} />, { density: 'pointer' })
  await expect.element(page.getByRole('row', { name: "Soldier's Joy" })).toBeVisible()
  await expect.poll(() => edit).not.toBeNull()
  return async (update) => {
    flushSync(() => edit!(update))
    // The list hears of the new rows in a microtask, still before the next frame.
    await Promise.resolve()
  }
}

// Only the list's own scripted motion: a row's CSS hover transition runs whenever a row passes
// under the pointer an earlier test left behind.
const slides = (row: Element) =>
  row
    .getAnimations()
    .filter((motion) => !(motion instanceof CSSTransition || motion instanceof CSSAnimation))

const moving = (name: string) => slides(page.getByRole('row', { name }).element()).length > 0

/** A removed row's last frame, which lies in the list while it fades. */
const fading = () => document.querySelectorAll('[role="grid"] > [aria-hidden="true"]').length

it('slides the rows below a removed row up while the removed row fades', async () => {
  const change = await mounted()
  await change((titles) => titles.filter((title) => title !== 'Angeline the Baker'))
  expect(moving('Cluck Old Hen')).toBe(true)
  expect(moving("Soldier's Joy")).toBe(true)
  expect(moving('Forked Deer')).toBe(false)
  expect(fading()).toBe(1)
  await expect.poll(fading).toBe(0)
})

it('fades a new row in and slides the rows below it down', async () => {
  const change = await mounted()
  await change((titles) => [titles[0]!, 'Salt Creek', ...titles.slice(1)])
  expect(moving('Salt Creek')).toBe(true)
  expect(moving('Angeline the Baker')).toBe(true)
  expect(moving('Forked Deer')).toBe(false)
})

it('glides rows to their new places when the order changes', async () => {
  const change = await mounted()
  await change((titles) => [...titles].reverse())
  expect(TITLES.every(moving)).toBe(true)
})

it('moves nothing on first paint', async () => {
  await mounted()
  expect(TITLES.some(moving)).toBe(false)
})

const MANY = Array.from({ length: 80 }, (_, i) => `Tune ${String(i).padStart(2, '0')}`)

function ManyTunes({ onEdit }: { onEdit: (edit: Edit) => void }) {
  const [titles, setTitles] = useState(MANY)
  useEffect(() => onEdit(setTitles), [onEdit])
  return (
    // A scroller of its own, as a pane is.
    <div data-scroller style={{ height: 600, overflowY: 'auto' }}>
      <RowList label="Tunes" virtualized="page">
        {titles.map((title) => (
          <Row key={title} id={title} textValue={title} title={title} />
        ))}
      </RowList>
    </div>
  )
}

async function mountedMany(): Promise<Edit> {
  let edit: Edit | null = null
  renderWithProviders(<ManyTunes onEdit={(next) => (edit = next)} />, { density: 'pointer' })
  await expect.element(page.getByRole('row', { name: 'Tune 00' })).toBeVisible()
  await expect.poll(() => edit).not.toBeNull()
  return edit!
}

const anyMoving = () =>
  [...document.querySelectorAll<HTMLElement>('[role="row"]')].some((row) => slides(row).length > 0)

it('slides the rows below a removed row up in a virtualized list', async () => {
  const edit = await mountedMany()
  edit((titles) => titles.filter((title) => title !== 'Tune 02'))
  await expect.poll(() => moving('Tune 05')).toBe(true)
  expect(moving('Tune 00')).toBe(false)
})

it('fades a new row in to a virtualized list', async () => {
  const edit = await mountedMany()
  edit((titles) => [titles[0]!, 'Tune 00a', ...titles.slice(1)])
  await expect.poll(() => moving('Tune 00a')).toBe(true)
})

it('moves no row as a virtualized list scrolls rows in and out', async () => {
  await mountedMany()
  const frames: boolean[] = []
  let running = true
  const tick = () => {
    if (!running) return
    frames.push(anyMoving())
    requestAnimationFrame(tick)
  }
  tick()
  const scroller = document.querySelector<HTMLElement>('[data-scroller]')!
  try {
    // Tune 40 at the top, on 32px pointer rows.
    scroller.scrollTop = 40 * 32
    await expect.element(page.getByRole('row', { name: 'Tune 40' })).toBeInTheDocument()
    await expect.element(page.getByRole('row', { name: 'Tune 00' })).not.toBeInTheDocument()
  } finally {
    running = false
  }
  expect(frames.filter(Boolean)).toEqual([])
})
