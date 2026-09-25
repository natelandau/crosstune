import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createTune, setArchived } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import type { CatalogEntry } from './filters'
import { SEARCH_TUNES, TuneSearch } from './TuneSearch'

let db: CrosstuneDb
let joy: { tuneId: string; userTuneId: string }
let hen: { tuneId: string; userTuneId: string }

beforeEach(async () => {
  db = openTestDb()
  joy = await createTune(db, { title: "Soldier's Joy", key: 'D' }, { status: 'known' })
  hen = await createTune(db, { title: 'Cluck Old Hen', key: 'A' }, { status: 'learning' })
})

function Host({
  taken,
  takenLabel,
  rowName = (title: string) => `Add to ${title}`,
  clearOnPick = false,
  keepFocus = false,
  onPick = () => {},
  onCreate = () => {},
  onQuery = () => {},
}: {
  taken?: ReadonlySet<string>
  takenLabel?: string
  rowName?: (title: string) => string
  /** Stands in for a caller that empties the field between picks. */
  clearOnPick?: boolean
  keepFocus?: boolean
  onPick?: (entry: CatalogEntry) => void
  onCreate?: (title: string) => void
  onQuery?: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  return (
    <>
      <TuneSearch
        name={SEARCH_TUNES}
        taken={taken}
        takenLabel={takenLabel}
        rowName={rowName}
        onPick={(entry) => {
          onPick(entry)
          if (clearOnPick) setQuery('')
        }}
        onCreate={onCreate}
        query={query}
        onQuery={(next) => {
          onQuery(next)
          setQuery(next)
        }}
        keepFocus={keepFocus}
      />
      <output data-testid="query">{query}</output>
    </>
  )
}

const search = () => page.getByRole('searchbox', { name: SEARCH_TUNES })
const held = () => document.querySelector('[data-testid=query]')!.textContent

describe('TuneSearch', () => {
  it("names an addable row with the caller's words", async () => {
    renderIonic(<Host />, { db })
    await search().fill('cluck')
    await expect.element(page.getByRole('button', { name: 'Add to Cluck Old Hen' })).toBeVisible()
  })

  it("says an archived tune is archived after the caller's words", async () => {
    await setArchived(db, hen.userTuneId, true)
    renderIonic(<Host />, { db })
    await search().fill('cluck')
    await expect
      .element(page.getByRole('button', { name: 'Add to Cluck Old Hen, archived' }))
      .toBeVisible()
  })

  it("marks a taken tune with the caller's note instead of offering it", async () => {
    renderIonic(<Host taken={new Set([joy.userTuneId])} takenLabel="Already filed" />, { db })
    await search().fill('soldier')
    await expect.element(page.getByText('Already filed')).toBeVisible()
    expect(page.getByRole('button', { name: "Add to Soldier's Joy" }).elements()).toHaveLength(0)
  })

  it('reports a taken tune neither from a tap nor from Enter', async () => {
    const onPick = vi.fn()
    renderIonic(
      <Host taken={new Set([joy.userTuneId])} takenLabel="Already filed" onPick={onPick} />,
      { db },
    )
    await search().fill("Soldier's Joy")
    await expect.element(page.getByText('Already filed')).toBeVisible()
    await page.getByRole('heading', { name: "Soldier's Joy" }).click({ force: true })
    // Enter with a lone match resolves to that tune, so a taken one has to be refused here too.
    await search().fill("Soldier's Joy")
    await expect.element(page.getByText('Already filed')).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(onPick).not.toHaveBeenCalled()
  })

  it('reports every keystroke and shows only the query it is given', async () => {
    const onQuery = vi.fn()
    renderIonic(<Host onQuery={onQuery} />, { db })
    await search().fill('cluck')
    await vi.waitFor(() => expect(onQuery).toHaveBeenCalledWith('cluck'))
    await expect.poll(held).toBe('cluck')
  })

  it('leaves the field alone on a pick, so only the caller empties it', async () => {
    const onPick = vi.fn()
    renderIonic(<Host onPick={onPick} />, { db })
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Add to Cluck Old Hen' }).click()
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledOnce())
    expect(onPick.mock.calls[0]?.[0].tune.title).toBe('Cluck Old Hen')
    await expect.poll(held).toBe('cluck')
    await expect.element(search()).toHaveValue('cluck')
  })

  it('empties the field once the caller clears the query it was given', async () => {
    renderIonic(<Host clearOnPick />, { db })
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Add to Cluck Old Hen' }).click()
    await expect.poll(held).toBe('')
    await expect.element(search()).toHaveValue('')
  })

  it('hands focus back to the field for a caller that picks several', async () => {
    renderIonic(<Host clearOnPick keepFocus />, { db })
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Add to Cluck Old Hen' }).click()
    await vi.waitFor(() => expect(document.activeElement).toBe(search().element()))
  })

  it('leaves focus where the pick left it for a caller that closes on one', async () => {
    renderIonic(<Host clearOnPick />, { db })
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Add to Cluck Old Hen' }).click()
    await expect.poll(held).toBe('')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(document.activeElement).not.toBe(search().element())
  })

  it('offers to create a tune by the typed title', async () => {
    const onCreate = vi.fn()
    renderIonic(<Host onCreate={onCreate} />, { db })
    await search().fill('Sally Goodin')
    await expect.element(page.getByText('No tune called "Sally Goodin"')).toBeVisible()
    await page.getByRole('button', { name: 'Add "Sally Goodin"' }).click()
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledWith('Sally Goodin'))
  })
})
