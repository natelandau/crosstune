import { IonList } from '@ionic/react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { ListItem } from './ListItem'
import type { ListSummary } from './useLists'

const today = new Date().toISOString()

function summary(overrides: Partial<ListSummary> = {}): ListSummary {
  return {
    id: 'l1',
    name: 'Tuesday jam',
    position: 0,
    created_at: today,
    updated_at: today,
    deleted_at: null,
    server_seq: 0,
    count: 3,
    lastEditedAt: today,
    ...overrides,
  }
}

describe('ListItem', () => {
  it('shows the name in the headline role and the count with the edit date', async () => {
    renderIonic(
      <IonList>
        <ListItem list={summary()} onOpen={() => {}} />
      </IonList>,
      { db: openTestDb() },
    )
    const name = page.getByRole('heading', { name: 'Tuesday jam' })
    await expect.element(name).toBeVisible()
    expect(name.element().classList.contains('type-headline')).toBe(true)
    await expect.element(page.getByText('3 tunes · Edited today')).toBeVisible()
  })

  it('counts one tune in the singular', async () => {
    renderIonic(
      <IonList>
        <ListItem list={summary({ count: 1 })} />
      </IonList>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('1 tune · Edited today')).toBeVisible()
  })
})
