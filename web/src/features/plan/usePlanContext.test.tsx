import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it } from 'vitest'
import { deleteRecording } from '../../commands/recordings'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { entitlementRow, recordingRow } from '../../test/rows'
import type { PlanContext } from './planCopy'
import { usePlanContext } from './usePlanContext'

it('falls back to exporting everything without a gap when the subject is deleted', async () => {
  const db = openTestDb()
  await db.entitlements.put(
    entitlementRow({ premium_source: 'stripe', premium_expires_at: '2026-01-01T00:00:00.000Z' }),
  )
  await db.recordings.bulkPut([recordingRow('r1'), recordingRow('r2')])
  const Data = dataProviders({ db })
  const wrapper = ({ children }: { children: ReactNode }) => <Data>{children}</Data>
  const seen: (PlanContext | null)[] = []
  renderHook(
    () => {
      const { context } = usePlanContext('recordings', { recordingId: 'r1' })
      seen.push(context)
    },
    { wrapper },
  )
  await expect.poll(() => seen.at(-1)?.action).toBe('export_recording')
  const shown = seen.length

  await deleteRecording(db, 'r1')

  await expect.poll(() => seen.at(-1)?.action).toBe('export_all')
  expect(seen.slice(shown).filter((context) => context === null)).toEqual([])
})
