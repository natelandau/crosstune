import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { openPickerRow } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { providerLabel } from '../links/display'
import {
  ALL_RECORDINGS,
  MY_RECORDINGS,
  RecordingsFilterSheet,
  SOURCE_SECTION,
} from './RecordingsFilterSheet'
import type { OriginChoice } from './useRecordingsOrigin'

const SLIPPERY = providerLabel({ provider: 'slippery_hill' })

function Host({ start = 'all', origins }: { start?: OriginChoice; origins: readonly string[] }) {
  const [choice, setChoice] = useState<OriginChoice>(start)
  return (
    <>
      <p data-testid="choice">{choice}</p>
      <RecordingsFilterSheet
        open
        choice={choice}
        origins={origins}
        onChange={setChoice}
        onClose={() => {}}
      />
    </>
  )
}

const choice = () => document.querySelector('[data-testid=choice]')?.textContent

const source = (value: string) =>
  page.getByRole('button', { name: `${SOURCE_SECTION}, ${value}`, exact: true })

async function openSource(value: string) {
  await openPickerRow(`${SOURCE_SECTION}, ${value}`, { exact: true })
  await expect.element(page.getByRole('radio', { name: ALL_RECORDINGS })).toBeVisible()
}

const options = () =>
  page
    .getByRole('radio')
    .elements()
    .map((option) => option.textContent?.trim())

describe('RecordingsFilterSheet', () => {
  it('offers All, Mine, then each import site held', async () => {
    renderIonic(<Host origins={['slippery_hill']} />, { db: openTestDb() })
    await expect.element(source(ALL_RECORDINGS)).toBeInTheDocument()
    await openSource(ALL_RECORDINGS)
    await expect.poll(options).toEqual([ALL_RECORDINGS, MY_RECORDINGS, SLIPPERY])
  })

  it('applies a choice at once, and Reset returns to All', async () => {
    renderIonic(<Host origins={['slippery_hill']} />, { db: openTestDb() })
    const reset = page.getByRole('button', { name: 'Reset' })
    await expect.element(reset).toBeDisabled()
    await openSource(ALL_RECORDINGS)
    await page.getByRole('radio', { name: SLIPPERY }).click()
    await expect.poll(choice).toBe('slippery_hill')
    await expect.element(source(SLIPPERY)).toBeInTheDocument()
    await expect.element(reset).toBeEnabled()
    await reset.click()
    await expect.poll(choice).toBe('all')
    await expect.element(source(ALL_RECORDINGS)).toBeInTheDocument()
  })

  it('keeps an option for a chosen site no longer held', async () => {
    renderIonic(<Host start="slippery_hill" origins={[]} />, { db: openTestDb() })
    await expect.element(source(SLIPPERY)).toBeInTheDocument()
    await openSource(SLIPPERY)
    await expect.poll(options).toEqual([ALL_RECORDINGS, MY_RECORDINGS, SLIPPERY])
  })

  it('orders an unknown site after the known ones, and a stale choice by rank', async () => {
    renderIonic(<Host start="slippery_hill" origins={['zzz_new_site']} />, {
      db: openTestDb(),
    })
    await openSource(SLIPPERY)
    await expect
      .poll(options)
      .toEqual([
        ALL_RECORDINGS,
        MY_RECORDINGS,
        SLIPPERY,
        providerLabel({ provider: 'zzz_new_site' }),
      ])
  })
})
