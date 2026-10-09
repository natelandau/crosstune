import { page, userEvent } from 'vitest/browser'
import { beforeEach, expect, it, onTestFinished } from 'vitest'
import { render } from '@testing-library/react'
import { deleteTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { LARGER_TEXT, lyricsTitle, SMALLER_TEXT } from './lyricsCopy'
import { DEFAULT_LYRICS_STEP, LYRICS_STEPS, setLyricsStep } from './lyricsSize'
import { EDIT_TUNE_TITLE, SAVE_TUNE } from '../tune/tuneFormCopy'
import { EDIT_LYRICS, EDIT_TUNE, LYRICS_SECTION, OPEN_LYRICS } from '../tune/tuneScreenCopy'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { tuneRow, userTuneRow } from '../../test/rows'
import { CLOSE, DONE } from '../../ui/confirmCopy'
import { renderWithProviders } from '../../test/render'
import { renderApp } from '../../test/renderApp'
import { LyricsReader } from './LyricsReader'
import { Verses } from './Verses'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }

const WORDS = 'Did you ever go to meeting\nUncle Joe\n\nDon’t mind the weather'

beforeEach(() => {
  // The store caches the step in module scope, which clearing storage does not reset.
  setLyricsStep(DEFAULT_LYRICS_STEP)
})

async function seedTune(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'Uncle Joe', { lyrics: WORDS }))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
}

const reader = () => page.getByRole('dialog', { name: lyricsTitle('Uncle Joe') })
const openRow = () => page.getByRole('button', { name: new RegExp(`^${OPEN_LYRICS}`) })
const size = () => reader().element().querySelector<HTMLElement>('[data-lyrics-size]')

async function openReader(frame = PHONE) {
  const db = openTestDb()
  await seedTune(db)
  await renderApp({
    path: '/catalog/t1',
    db,
    frame,
    density: frame === PHONE ? 'touch' : 'pointer',
  })
  await openRow().click()
  await expect.element(reader()).toBeVisible()
  return db
}

it.each([
  ['phone', PHONE],
  ['wide', WIDE],
] as const)(
  'opens from the tune page on %s, verse by verse, over the whole window',
  async (_, frame) => {
    await openReader(frame)
    await expect.element(reader().getByRole('heading', { name: 'Uncle Joe' })).toBeVisible()
    await expect.element(reader().getByText('Did you ever go to meeting')).toBeVisible()
    await expect.element(reader().getByText('Don’t mind the weather')).toBeVisible()
    await expect.poll(() => reader().element().querySelectorAll('[data-verse]').length).toBe(2)
    await expect
      .poll(() => {
        const box = reader().element().getBoundingClientRect()
        return [box.left, box.top, box.width, box.height]
      })
      .toEqual([0, 0, frame.width, frame.height])
  },
)

it('closes on Escape and from Close, handing focus back to the row', async () => {
  await openReader()
  await userEvent.keyboard('{Escape}')
  await expect.element(reader()).not.toBeInTheDocument()
  await expect.element(openRow()).toHaveFocus()
  await openRow().click()
  await reader().getByRole('button', { name: CLOSE, exact: true }).click()
  await expect.element(reader()).not.toBeInTheDocument()
  await expect.element(openRow()).toHaveFocus()
})

it('steps the text up, and holds Larger text disabled at the largest', async () => {
  await openReader()
  const larger = reader().getByRole('button', { name: LARGER_TEXT, exact: true })
  await expect.poll(() => size()?.dataset.lyricsSize).toBe(String(DEFAULT_LYRICS_STEP))
  const before = () => parseFloat(getComputedStyle(size()!).fontSize)
  const start = before()
  await larger.click()
  await expect.poll(() => size()?.dataset.lyricsSize).toBe(String(DEFAULT_LYRICS_STEP + 1))
  await expect.poll(before).toBeGreaterThan(start)
  await expect
    .element(reader().getByRole('status'))
    .toHaveTextContent(`Text size ${DEFAULT_LYRICS_STEP + 1} of ${LYRICS_STEPS}`)
  await larger.click()
  await expect.poll(() => size()?.dataset.lyricsSize).toBe(String(LYRICS_STEPS))
  await expect.element(larger).toHaveAttribute('aria-disabled', 'true')
  // Out of scale but still focused, so the next Tab goes on from it.
  await expect.element(larger).toHaveFocus()
  await expect
    .element(reader().getByRole('button', { name: SMALLER_TEXT, exact: true }))
    .not.toHaveAttribute('aria-disabled', 'true')
})

it('lines Edit lyrics up with the words on wide, at every size', async () => {
  await openReader(WIDE)
  const edit = reader().getByRole('button', { name: EDIT_LYRICS, exact: true })
  const edges = () => {
    const words = size()!.getBoundingClientRect()
    const button = edit.element().getBoundingClientRect()
    return [button.left - words.left, button.right - words.right]
  }
  await expect.element(edit).toBeVisible()
  await expect.poll(edges).toEqual([0, 0])
  await reader().getByRole('button', { name: LARGER_TEXT, exact: true }).click()
  await expect.poll(() => size()?.dataset.lyricsSize).toBe(String(DEFAULT_LYRICS_STEP + 1))
  await expect.poll(edges).toEqual([0, 0])
})

it('edits the words in place, and the reader and the tune both take them', async () => {
  const db = await openReader()
  await reader().getByRole('button', { name: EDIT_LYRICS, exact: true }).click()
  const editor = page.getByRole('dialog', { name: LYRICS_SECTION })
  const words = editor.getByRole('textbox', { name: LYRICS_SECTION })
  await expect.element(words).toHaveValue(WORDS)
  await words.fill('Uncle Joe, Uncle Joe\n\nGo to meeting')
  await editor.getByRole('button', { name: DONE, exact: true }).click()
  await expect.element(editor).not.toBeInTheDocument()
  await expect.element(reader().getByText('Go to meeting', { exact: true })).toBeVisible()
  await expect
    .poll(async () => (await db.tunes.get('t1'))?.lyrics)
    .toBe('Uncle Joe, Uncle Joe\n\nGo to meeting')
})

it('leaves the tune alone while the form edits its words, until the form saves', async () => {
  const db = openTestDb()
  await seedTune(db)
  await renderApp({ path: '/catalog/t1', db, frame: PHONE, density: 'touch' })
  await page.getByRole('button', { name: EDIT_TUNE, exact: true }).click()
  const form = page.getByRole('dialog', { name: EDIT_TUNE_TITLE })
  const words = form.getByRole('textbox', { name: LYRICS_SECTION })
  await expect.element(words).toHaveValue(WORDS)
  await words.fill('Go to meeting')
  await expect.poll(async () => (await db.tunes.get('t1'))?.lyrics).toBe(WORDS)
  await form.getByRole('button', { name: SAVE_TUNE, exact: true }).click()
  await expect.element(form).not.toBeInTheDocument()
  await expect.poll(async () => (await db.tunes.get('t1'))?.lyrics).toBe('Go to meeting')
})

it('holds a step at one size whatever the text size setting', async () => {
  await openReader()
  const fontSize = () => getComputedStyle(size()!).fontSize
  await expect.poll(() => size()?.dataset.lyricsSize).toBe(String(DEFAULT_LYRICS_STEP))
  const at = fontSize()
  const html = document.documentElement
  html.dataset.textSize = 'roomy'
  onTestFinished(() => {
    delete html.dataset.textSize
  })
  // The page's own type grows, so the setting took hold.
  await expect.poll(() => getComputedStyle(html).fontSize).toBe('17px')
  await expect.poll(fontSize).toBe(at)
})

it('closes once its tune is deleted while it reads', async () => {
  const db = await openReader()
  await deleteTune(db, 't1')
  await expect.element(reader()).not.toBeInTheDocument()
})

it('keeps its name and words through the fade once its tune has gone', async () => {
  const db = openTestDb()
  const props = { tuneId: 't1', onOpenChange: () => {} }
  const view = render(<LyricsReader {...props} title="Uncle Joe" lyrics={WORDS} isOpen />, {
    wrapper: dataProviders({ db }),
  })
  await expect.element(reader().getByText('Did you ever go to meeting')).toBeVisible()
  // Every change the exit makes to the DOM, until the dialog has gone.
  const seen: { name: string | null; words: boolean }[] = []
  const observer = new MutationObserver(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return
    seen.push({
      name: dialog.getAttribute('aria-label'),
      words: dialog.textContent?.includes('Did you ever go to meeting') ?? false,
    })
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  })
  onTestFinished(() => observer.disconnect())
  view.rerender(<LyricsReader {...props} title="" lyrics={null} isOpen={false} />)
  await expect.element(reader()).not.toBeInTheDocument()
  observer.disconnect()
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.filter((frame) => frame.name !== lyricsTitle('Uncle Joe') || !frame.words)).toEqual(
    [],
  )
})

it('hangs a wrapped line under its own start', async () => {
  const words = 'Did you ever go to meeting, Uncle Joe, Uncle Joe, did you ever go to meeting'
  renderWithProviders(
    <div className="w-[240px]">
      <Verses verses={[[words]]} step={1} />
    </div>,
  )
  const line = page.getByText(words)
  await expect.element(line).toBeVisible()
  const lineBoxes = () => {
    const range = document.createRange()
    range.selectNodeContents(line.element())
    return [...range.getClientRects()]
  }
  await expect.poll(() => lineBoxes().length).toBeGreaterThan(1)
  const [first, ...wraps] = lineBoxes()
  // The first line starts at the margin; every wrap starts further in.
  expect(Math.round(first!.left)).toBe(Math.round(line.element().getBoundingClientRect().left))
  for (const wrap of wraps) expect(wrap.left).toBeGreaterThan(first!.left)
})
