import * as Sentry from '@sentry/react'
import { TUNE_LIMITS } from '../../api/vocabulary'
import { useAuthSession } from '../../auth/AuthContext'
import { addToList } from '../../commands/lists'
import { updateRecording } from '../../commands/recordings'
import { settingsId } from '../../commands/settings'
import { createTune } from '../../commands/tunes'
import { useDb } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { storedNewTuneGenre, storedNewTuneStatus } from '../../db/types'
import { messageFor } from '../../ui/useAction'
import type { AnalyticsClient } from '../../usage/client'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { Source } from '../../usage/events'
import { titleOnlyFieldsSet } from '../../usage/tuneFields'
import { reportRecordingFiled } from '../recordings/reportRecordingFiled'

export interface CreateTuneOptions {
  title: string
  /** Where the tune was offered, reported with the create. */
  source: Source
  /** The new tune is added to this list. */
  listId?: string
  /** The new tune is given this recording. */
  recordingId?: string
}

export interface CreatedTune {
  tuneId: string
  userTuneId: string
  /** The title as stored, trimmed and held to its limit. */
  title: string
  /** Why the list or recording refused a tune that was created all the same. */
  filingError?: string
}

/**
 * Files a tune that exists into a list and under a recording. A refusal never undoes the
 * tune, because a retry would create it twice; each filing is tried on its own and the first
 * refusal is returned.
 */
export async function fileNewTune(
  db: CrosstuneDb,
  analytics: AnalyticsClient,
  ids: { tuneId: string; userTuneId: string },
  filing: { listId?: string; recordingId?: string },
): Promise<string | undefined> {
  const { listId, recordingId } = filing
  let filingError: string | undefined
  // Read before the write, because the report classifies by the tune it leaves. A failed
  // read costs the report, never the filing.
  const before = recordingId
    ? await db.recordings.get(recordingId).catch((error: unknown) => {
        Sentry.captureException(error)
        return undefined
      })
    : undefined
  const filings = [
    listId ? () => addToList(db, listId, ids.userTuneId) : null,
    recordingId
      ? async () => {
          await updateRecording(db, recordingId, { tune_id: ids.tuneId })
          if (before) reportRecordingFiled(analytics, before, ids.tuneId)
        }
      : null,
  ]
  for (const file of filings) {
    await file?.().catch((caught: unknown) => {
      filingError ??= messageFor(caught)
    })
  }
  return filingError
}

/** Creates a tune from its title alone, with the New tunes status and genre applied. */
export function useCreateTune(): (options: CreateTuneOptions) => Promise<CreatedTune> {
  const db = useDb()
  const analytics = useAnalytics()
  const { userId } = useAuthSession()
  return async ({ title, source, listId, recordingId }) => {
    // Read at the moment of the create, so the settings are never still loading.
    const settings = (await db.user_settings.get(settingsId(userId))) ?? null
    const tune = {
      // Trimmed first, so the limit counts the title's own text rather than the spaces before it.
      title: title.trim().slice(0, TUNE_LIMITS.title).trim(),
      genre: storedNewTuneGenre(settings)?.trim() || null,
    }
    const userTune = { status: storedNewTuneStatus(settings) }
    const created = await createTune(db, tune, userTune)
    analytics.send('tune_created', {
      source,
      fields_set: titleOnlyFieldsSet(tune, userTune),
      tune_id: created.tuneId,
    })
    const filingError = await fileNewTune(db, analytics, created, { listId, recordingId })
    return { ...created, title: tune.title, filingError }
  }
}
