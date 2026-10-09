import { useMemo, useRef } from 'react'
import type { TuneStatus } from '../../api/vocabulary'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { useAuthSession } from '../../auth/AuthContext'
import { setNewTuneGenre, setNewTuneStatus } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import { storedNewTuneGenre, storedNewTuneStatus } from '../../db/types'
import { useAction } from '../../ui/useAction'
import { usePendingWrite } from '../../ui/usePendingWrite'
import { useSettingsRow } from './useSettingsRow'

interface NewTuneDefaults {
  genre: string | null
  status: TuneStatus
}

export interface NewTuneSettings {
  /** Undefined until the settings row has been read. Shows a choice still being written. */
  defaults: NewTuneDefaults | undefined
  setGenre: (genre: string) => void
  setStatus: (status: TuneStatus) => void
  genreError: string | null
  statusError: string | null
}

/** The genre and status every new tune starts with. */
export function useNewTuneSettings(): NewTuneSettings {
  const db = useDb()
  const { userId } = useAuthSession()
  const analytics = useAnalytics()
  const genreAction = useAction()
  const statusAction = useAction()
  const row = useSettingsRow()
  // usePendingWrite tells a landed write by identity, so the stored value has to outlive a render.
  const stored = useMemo(
    () =>
      row === undefined
        ? undefined
        : { genre: storedNewTuneGenre(row), status: storedNewTuneStatus(row) },
    [row],
  )
  // Whether the last genre write that succeeded held a genre, so a flip is judged against what
  // was stored even when a write between fails. Writes run one at a time, so this is exact.
  const genreSetRef = useRef(false)
  const genreWritesRef = useRef(0)
  const [defaults, write] = usePendingWrite<NewTuneDefaults>(stored, async (patch) => {
    if (patch.genre !== undefined) await setNewTuneGenre(db, userId, patch.genre)
    if (patch.status !== undefined) await setNewTuneStatus(db, userId, patch.status)
  })
  return {
    defaults: defaults ?? undefined,
    // The genre writes on every keystroke, so only a flip between set and unset is reported,
    // and never the genre itself, which is free text.
    setGenre: (genre) => {
      const isSet = isGenreSet(genre)
      // With no write in flight the value on screen is the stored one, which a sync may have changed.
      if (genreWritesRef.current === 0) genreSetRef.current = isGenreSet(defaults?.genre)
      genreWritesRef.current += 1
      genreAction.run(() =>
        write({ genre: isSet ? genre : null })
          .finally(() => (genreWritesRef.current -= 1))
          .then(() => {
            if (isSet !== genreSetRef.current) {
              analytics.send('setting_changed', { setting: 'new_tune_genre_set', value: isSet })
            }
            genreSetRef.current = isSet
          }),
      )
    },
    setStatus: (status) => {
      const changed = status !== defaults?.status
      statusAction.run(() =>
        write({ status }).then(() => {
          if (changed) {
            analytics.send('setting_changed', { setting: 'new_tune_status', value: status })
          }
        }),
      )
    },
    genreError: genreAction.error,
    statusError: statusAction.error,
  }
}

function isGenreSet(genre: string | null | undefined): boolean {
  return Boolean(genre?.trim())
}
