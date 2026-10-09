import { useMemo } from 'react'
import type { TuneStatus } from '../../api/vocabulary'
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
  const [defaults, write] = usePendingWrite<NewTuneDefaults>(stored, async (patch) => {
    if (patch.genre !== undefined) await setNewTuneGenre(db, userId, patch.genre)
    if (patch.status !== undefined) await setNewTuneStatus(db, userId, patch.status)
  })
  return {
    defaults: defaults ?? undefined,
    setGenre: (genre) => genreAction.run(() => write({ genre: genre.trim() ? genre : null })),
    setStatus: (status) => statusAction.run(() => write({ status })),
    genreError: genreAction.error,
    statusError: statusAction.error,
  }
}
