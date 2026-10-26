import { TUNE_NOT_FOUND } from '../../commands/messages'
import { updateTuneEntry, type TuneInput, type UserTuneInput } from '../../commands/tunes'
import { writeTx } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import type { CatalogEntry } from '../../db/types'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { AnalyticsClient } from '../../usage/client'
import { tuneFieldsChanged } from '../../usage/tuneFields'
import { useAction } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { useResetOnChange } from '../../ui/useResetOnChange'
import {
  inputsFromValues,
  learnedOnError,
  TITLE_REQUIRED,
  typeChanged,
  valuesFromRows,
  type TuneFormValues,
} from './tuneFormValues'

export type AttributePatch = Partial<TuneFormValues>

export interface AttributeWrite {
  /** Writes the patched attribute to the tune the hook was opened for, under the form's rules. */
  write: (patch: AttributePatch) => void
  /** The last write's rejection. */
  error: string | null
  pending: boolean
}

/** Reports an edit to a tune: the fields it changed, and a status change on its own. */
export function reportEdit(
  analytics: AnalyticsClient,
  before: CatalogEntry,
  tune: TuneInput,
  userTune: UserTuneInput,
) {
  const fields = tuneFieldsChanged(before, tune, userTune)
  if (fields.length === 0) return
  const tuneId = before.tune.id
  analytics.send('tune_edited', { fields_changed: fields, tune_id: tuneId })
  const from = valuesFromRows(before.tune, before.userTune).status
  if (fields.includes('status')) {
    analytics.send('tune_status_changed', { from, to: userTune.status, tune_id: tuneId })
  }
}

export function useAttributeWrite(tuneId: string): AttributeWrite {
  const db = useDb()
  const analytics = useAnalytics()
  const { error, pending, run, clear } = useAction()
  const tuneRef = useLatest(tuneId)
  useResetOnChange(tuneId, clear)

  const write = (patch: AttributePatch) => {
    const mine = tuneId
    run(async () => {
      let edit: Parameters<typeof reportEdit> | undefined
      try {
        // The read and the write share one transaction, so a notes keystroke or a sync pull
        // between them is never written over with the values read before it.
        edit = await writeTx(db, async () => {
          const tune = await db.tunes.get(mine)
          const userTune = await db.user_tunes.where('tune_id').equals(mine).first()
          if (!tune || tune.deleted_at || !userTune || userTune.deleted_at) {
            throw new Error(TUNE_NOT_FOUND)
          }
          let values = { ...valuesFromRows(tune, userTune), ...patch }
          if (patch.tune_type !== undefined) {
            values = typeChanged(values, patch.tune_type)
          }
          if (values.title.trim() === '') throw new Error(TITLE_REQUIRED)
          // Only a patch that sets the date answers for it; a stored one is the form's to fix.
          const learnedOnRefusal =
            patch.learned_on === undefined ? null : learnedOnError(values.learned_on)
          if (learnedOnRefusal) throw new Error(learnedOnRefusal)
          const inputs = inputsFromValues(values, tune.tunings)
          await updateTuneEntry(
            db,
            { tuneId: mine, userTuneId: userTune.id },
            inputs.tune,
            inputs.userTune,
          )
          return [analytics, { tune, userTune }, inputs.tune, inputs.userTune] as const
        })
      } catch (caught) {
        // A refusal that lands after another tune opened belongs to the old one.
        if (tuneRef.current === mine) throw caught
        return
      }
      reportEdit(...edit)
    })
  }

  return { write, error, pending }
}
