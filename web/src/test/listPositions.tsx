import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Instrument } from '../api/vocabulary'
import { addToList, createList } from '../commands/lists'
import { createTune } from '../commands/tunes'
import type { CrosstuneDb } from '../db/schema'
import { ListTunes } from '../features/lists/ListTunes'
import { useListView } from '../features/lists/useLists'
import { openTestDb } from './db'
import { renderIonic } from './ionic'

const VIOLIN: ReadonlySet<Instrument> = new Set<Instrument>(['violin'])
const TUNES = 105

/**
 * A list long enough to run its positions into three digits, in whichever mode the project
 * forces and at the widest text size, where each mode's own type scale decides how much room
 * three figures need.
 */
export function listPositionTests(mode: string) {
  describe(`list positions on ${mode}`, () => {
    let db: CrosstuneDb
    let listId: string

    beforeEach(async () => {
      db = openTestDb()
      listId = await createList(db, 'Tuesday jam')
    })

    afterEach(async () => {
      delete document.documentElement.dataset.textSize
      await db.delete()
    })

    function Host() {
      const view = useListView(listId)
      if (!view) return null
      return (
        <ListTunes
          listId={listId}
          items={view.items}
          showArchived={false}
          instruments={VIOLIN}
          onOpen={() => {}}
          onEdit={() => {}}
          onRemove={() => {}}
          onMoveStart={() => {}}
          onError={() => {}}
        />
      )
    }

    it('announces each position number rather than only painting it', async () => {
      for (const title of ['Reel 1', 'Reel 2']) {
        const { userTuneId } = await createTune(db, { title }, { status: 'known' })
        await addToList(db, listId, userTuneId)
      }
      renderIonic(<Host />, { db })
      const positions = () => Array.from(document.querySelectorAll('[data-position]'))
      await vi.waitFor(() => expect(positions()).toHaveLength(2))
      expect(positions().map((span) => span.textContent)).toEqual(['1', '2'])
      for (const span of positions()) {
        expect(span.closest('[aria-hidden="true"]')).toBeNull()
        expect(span.closest('button')).toBeNull()
      }
    })

    it('keeps every title on one line once the positions reach three digits', async () => {
      for (let index = 0; index < TUNES; index += 1) {
        const { userTuneId } = await createTune(
          db,
          { title: `Reel ${index + 1}` },
          { status: 'known' },
        )
        await addToList(db, listId, userTuneId)
      }
      document.documentElement.dataset.textSize = 'roomy'
      renderIonic(<Host />, { db })
      const titles = () => document.querySelectorAll('ion-reorder-group h2')
      await vi.waitFor(() => expect(titles()).toHaveLength(TUNES))
      const numbers = Array.from(document.querySelectorAll('[data-position]')).map(
        (span) => span.textContent,
      )
      expect([numbers[8], numbers[98], numbers[99]]).toEqual(['9', '99', '100'])
      const left = (index: number) => titles()[index]!.getBoundingClientRect().left
      expect(left(98)).toBe(left(8))
      expect(left(99)).toBe(left(8))
      expect(left(TUNES - 1)).toBe(left(8))
    }, 30000)
  })
}
