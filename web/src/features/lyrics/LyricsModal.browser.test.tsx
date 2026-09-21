import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createSong } from '../../commands/songs'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { DEFAULT_LYRICS_STEP, LYRICS_SIZE_KEY, LYRICS_STEPS, setLyricsStep } from './lyricsSize'
import { LyricsModal } from './LyricsModal'

const WORDS = 'Did you ever go to meeting\nUncle Joe\n\nDon’t mind the weather'

beforeEach(() => {
  localStorage.clear()
  // The store caches the step in module scope, which clearing storage does not reset, so each
  // case would otherwise start from whatever the previous one chose.
  setLyricsStep(DEFAULT_LYRICS_STEP)
  localStorage.clear()
})

function show(onClose = () => {}) {
  renderIonic(<LyricsModal open songId="s1" title="Uncle Joe" lyrics={WORDS} onClose={onClose} />, {
    db: openTestDb(),
  })
}

const body = () => document.querySelector<HTMLElement>('[data-lyrics-size]')

const status = () => document.querySelector('[role="status"]')

/** The modal as a screen holds it: mounted while the screen is, opened and closed again. */
function Reopenable() {
  const [open, setOpen] = useState(true)
  return (
    <>
      {/* Clicked through the DOM: a presented modal hides the rest of the app from a role query. */}
      <button type="button" data-toggle onClick={() => setOpen((shown) => !shown)}>
        Toggle
      </button>
      <LyricsModal
        open={open}
        songId="s1"
        title="Uncle Joe"
        lyrics={WORDS}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

/** An ion-button keeps its native button in a shadow root, which `closest` never leaves. */
function buttonHost(name: string): HTMLElement {
  const root = page.getByRole('button', { name }).element().getRootNode()
  return (root as ShadowRoot).host as HTMLElement
}

/** Focus inside a shadow root reads on the document as the host, so walk down to the real one. */
function focused(): Element | null {
  let node: Element | null = document.activeElement
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement
  return node
}

it('shows every line, grouped into verses', async () => {
  show()
  await expect.element(page.getByText('Did you ever go to meeting')).toBeVisible()
  await vi.waitFor(() => expect(document.querySelectorAll('[data-verse]')).toHaveLength(2))
})

it('steps the text size, remembers it, and clamps at the top', async () => {
  show()
  const larger = page.getByRole('button', { name: 'Larger text' })
  await vi.waitFor(() => expect(body()?.dataset.lyricsSize).toBe('4'))
  await larger.click()
  await vi.waitFor(() => expect(body()?.dataset.lyricsSize).toBe('5'))
  await larger.click()
  await vi.waitFor(() => expect(body()?.dataset.lyricsSize).toBe(String(LYRICS_STEPS)))
  expect(localStorage.getItem(LYRICS_SIZE_KEY)).toBe(String(LYRICS_STEPS))
  await expect.element(larger).toHaveAttribute('aria-disabled', 'true')
  // A control out of scale still reads as unavailable, dimmed as a disabled one is.
  expect(Number(getComputedStyle(buttonHost('Larger text')).opacity)).toBeLessThan(1)
})

it('keeps focus on the control that reached the end of the scale', async () => {
  show()
  const larger = page.getByRole('button', { name: 'Larger text' })
  await vi.waitFor(() => expect(body()?.dataset.lyricsSize).toBe('4'))
  await larger.click()
  await larger.click()
  await vi.waitFor(() => expect(body()?.dataset.lyricsSize).toBe(String(LYRICS_STEPS)))
  // The control that ran out of scale still holds focus, so the next Tab goes on from it.
  expect(focused()).toBe(larger.element())
})

it('reports the step to a screen reader only after a press', async () => {
  show()
  await vi.waitFor(() => expect(status()?.textContent).toBe(''))
  await page.getByRole('button', { name: 'Smaller text' }).click()
  await vi.waitFor(() => expect(status()?.textContent).toBe('Text size 3 of 6'))
})

it('says nothing about the last step when it opens again', async () => {
  renderIonic(<Reopenable />, { db: openTestDb() })
  const toggle = () => document.querySelector<HTMLButtonElement>('[data-toggle]')!
  await page.getByRole('button', { name: 'Smaller text' }).click()
  await vi.waitFor(() => expect(status()?.textContent).toBe('Text size 3 of 6'))
  toggle().click()
  await vi.waitFor(() => expect(document.querySelector('ion-modal.overlay-hidden')).not.toBeNull())
  toggle().click()
  await vi.waitFor(() =>
    expect(document.querySelector('ion-modal:not(.overlay-hidden)')).not.toBeNull(),
  )
  expect(status()?.textContent).toBe('')
})

it('closes from its own control', async () => {
  const onClose = vi.fn()
  show(onClose)
  await page.getByRole('button', { name: 'Close' }).click()
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
})

it('opens where the wake lock API is missing', async () => {
  Reflect.deleteProperty(navigator, 'wakeLock')
  show()
  await expect.element(page.getByText('Don’t mind the weather')).toBeVisible()
})

it('steps the text size down and clamps at the bottom', async () => {
  show()
  const smaller = page.getByRole('button', { name: 'Smaller text' })
  await vi.waitFor(() => expect(body()?.dataset.lyricsSize).toBe('4'))
  for (let i = 0; i < 3; i++) await smaller.click()
  await vi.waitFor(() => expect(body()?.dataset.lyricsSize).toBe('1'))
  await expect.element(smaller).toHaveAttribute('aria-disabled', 'true')
})

it('pulls a line back to the margin by exactly its own hanging indent', async () => {
  show()
  const line = await vi.waitFor(() => {
    const p = document.querySelector<HTMLElement>('[data-verse] p')
    if (!p) throw new Error('no line rendered')
    return p
  })
  const style = getComputedStyle(line)
  const padding = Number.parseFloat(style.paddingLeft)
  const indent = Number.parseFloat(style.textIndent)
  // The padding offsets every line, including a wrap; the negative indent pulls only the first
  // line back by the same amount, so a wrap sits at the padding and a new line starts at 0.
  expect(padding).toBeGreaterThan(0)
  expect(indent).toBeCloseTo(-padding, 5)
})

it('gives every toolbar control a 44px tap target', async () => {
  show()
  await expect.element(page.getByRole('button', { name: 'Close' })).toBeVisible()
  for (const name of ['Smaller text', 'Larger text', 'Close']) {
    const box = buttonHost(name).getBoundingClientRect()
    // A control sized to the exact 44px minimum can render a few thousandths of a pixel under
    // it, from float rounding in the layout engine rather than from the rule itself.
    expect(Math.round(box.height), name).toBeGreaterThanOrEqual(44)
    expect(Math.round(box.width), name).toBeGreaterThanOrEqual(44)
  }
})

it('gives a verse a larger gap than the gap between its own lines', async () => {
  // Short lines that never wrap at any step, so each offsetTop delta below is a clean line
  // gap or verse gap rather than a wrapped line's own height.
  renderIonic(
    <LyricsModal open songId="s1" title="Short" lyrics={'One\nTwo\n\nThree'} onClose={() => {}} />,
    {
      db: openTestDb(),
    },
  )
  await expect.element(page.getByText('Three')).toBeVisible()
  await vi.waitFor(() => {
    const verses = document.querySelectorAll<HTMLElement>('[data-verse]')
    expect(verses).toHaveLength(2)
    const [first, second] = verses
    const firstLines = first!.querySelectorAll<HTMLElement>('p')
    const withinVerseGap = firstLines[1]!.offsetTop - firstLines[0]!.offsetTop
    const secondLines = second!.querySelectorAll<HTMLElement>('p')
    const acrossVerseGap = secondLines[0]!.offsetTop - firstLines[firstLines.length - 1]!.offsetTop
    // A modal that has not been laid out puts every line at the same offset, where both gaps
    // are 0 and the comparison below holds no meaning.
    expect(withinVerseGap).toBeGreaterThan(0)
    expect(acrossVerseGap).toBeGreaterThan(withinVerseGap)
  })
})

it('edits the words from the end of them, and writes without a form', async () => {
  const db = openTestDb()
  const { songId } = await createSong(
    db,
    { title: 'Uncle Joe', lyrics: WORDS },
    { status: 'known' },
  )
  renderIonic(
    <LyricsModal open songId={songId} title="Uncle Joe" lyrics={WORDS} onClose={() => {}} />,
    { db },
  )
  // Past the last verse, where a musician who has read to the end already is, and where a
  // scroll mid-song never reaches.
  const edit = page.getByRole('button', { name: 'Edit lyrics' })
  await expect.element(edit).toBeVisible()
  const lastLine = Array.from(document.querySelectorAll<HTMLElement>('[data-verse] p')).at(-1)!
  const host = document.querySelector<HTMLElement>('ion-button[expand="block"]')!
  expect(host.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    lastLine.getBoundingClientRect().bottom,
  )

  await edit.click()
  const field = page.getByRole('textbox', { name: 'Lyrics' })
  await expect.element(field).toHaveValue(WORDS)
  await field.clear()
  await field.fill('New words entirely')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  // No song form stands behind this one, so the sheet's own Done is the write.
  await vi.waitFor(async () =>
    expect((await db.songs.get(songId))?.lyrics).toBe('New words entirely'),
  )
})

it('keeps refused words in the box, with the reason, rather than dropping them', async () => {
  const db = openTestDb()
  const { songId } = await createSong(
    db,
    { title: 'Uncle Joe', lyrics: WORDS },
    { status: 'known' },
  )
  // A song deleted from another device while the sheet is open is what the write meets.
  await db.songs.delete(songId)
  renderIonic(
    <LyricsModal open songId={songId} title="Uncle Joe" lyrics={WORDS} onClose={() => {}} />,
    { db },
  )
  await page.getByRole('button', { name: 'Edit lyrics' }).click()
  const field = page.getByRole('textbox', { name: 'Lyrics' })
  await expect.element(field).toHaveValue(WORDS)
  await field.clear()
  await field.fill('Words worth keeping')
  await page.getByRole('button', { name: 'Done', exact: true }).click()

  await expect.element(page.getByRole('alert')).toHaveTextContent('Song not found')
  await expect
    .element(page.getByRole('textbox', { name: 'Lyrics' }))
    .toHaveValue('Words worth keeping')
})

it('opens on the words after a close that left the editor up', async () => {
  const db = openTestDb()
  const { songId } = await createSong(
    db,
    { title: 'Uncle Joe', lyrics: WORDS },
    { status: 'known' },
  )
  function Screen() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button" data-toggle onClick={() => setOpen((shown) => !shown)}>
          Toggle
        </button>
        <LyricsModal
          open={open}
          songId={songId}
          title="Uncle Joe"
          lyrics={WORDS}
          onClose={() => setOpen(false)}
        />
      </>
    )
  }
  renderIonic(<Screen />, { db })
  await page.getByRole('button', { name: 'Edit lyrics' }).click()
  await expect.element(page.getByRole('textbox', { name: 'Lyrics' })).toBeVisible()
  // The screen closing under an open editor, the way a synced delete or a route change does.
  const toggle = document.querySelector<HTMLElement>('[data-toggle]')!
  toggle.click()
  await vi.waitFor(() => expect(document.querySelector('[data-lyrics-size]')).toBeNull())
  toggle.click()
  await expect.element(page.getByRole('button', { name: 'Edit lyrics' })).toBeVisible()
  expect(document.querySelector('ion-textarea')).toBeNull()
})

it('names the dialog for the title the song carries now', async () => {
  function Renamer() {
    const [title, setTitle] = useState('Old Joe')
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" data-rename onClick={() => setTitle('New Joe')}>
          Rename
        </button>
        <button type="button" data-open onClick={() => setOpen(true)}>
          Open
        </button>
        <LyricsModal
          open={open}
          songId="s1"
          title={title}
          lyrics={WORDS}
          onClose={() => setOpen(false)}
        />
      </>
    )
  }
  renderIonic(<Renamer />, { db: openTestDb() })
  // A rename on the screen behind the modal, which is mounted with that screen and closed.
  document.querySelector<HTMLElement>('[data-rename]')!.click()
  document.querySelector<HTMLElement>('[data-open]')!.click()
  await expect.element(page.getByRole('button', { name: 'Edit lyrics' })).toBeVisible()
  await vi.waitFor(() =>
    expect(
      document
        .querySelector('ion-modal')
        ?.shadowRoot?.querySelector('[role="dialog"]')
        ?.getAttribute('aria-label'),
    ).toBe('New Joe lyrics'),
  )
})
