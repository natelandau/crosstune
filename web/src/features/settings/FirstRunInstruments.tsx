import { useEffect, useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { setInstruments } from '../../commands/settings'
import { ErrorText, HelpText } from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { storedInstruments, type Instrument } from '../../db/types'
import { useLastSyncedAt } from '../../sync/SyncProvider'
import { InstrumentPicker } from './InstrumentPicker'
import { useSettingsRow } from './useSettingsRow'

// The sync status can announce a clean run a beat before the live query delivers the row
// that run pulled, so the prompt waits this long to be sure the row is really absent.
export const FIRST_RUN_GRACE_MS = 750

export const FIRST_RUN_TITLE = 'Which instruments do you play?'

/**
 * Asks a new account which instruments it plays and writes the settings row, so the violin-only
 * default is only ever a placeholder. It opens once the first clean sync of the session has run
 * and found no row: a new device for an existing account has no row until that pull, and an
 * offline session never syncs, so neither is asked.
 */
export function FirstRunInstruments() {
  const db = useDb()
  const { userId, offline } = useAuthSession()
  const row = useSettingsRow()
  const syncedAt = useLastSyncedAt()
  const [chosen, setChosen] = useState<ReadonlySet<Instrument>>(() => new Set())
  const { error, pending, run } = useAction()

  const missing =
    !offline && syncedAt !== null && row !== undefined && storedInstruments(row) === null
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    if (!missing) return
    const timer = setTimeout(() => setGraceOver(true), FIRST_RUN_GRACE_MS)
    return () => clearTimeout(timer)
  }, [missing])
  const open = missing && graceOver

  return (
    <Sheet open={open} title={FIRST_RUN_TITLE} dismissible={false} onClose={() => {}}>
      <div className="space-y-3">
        <InstrumentPicker
          label="Instruments"
          value={chosen}
          onToggle={(instrument, on) =>
            setChosen((current) => {
              const next = new Set(current)
              if (on) next.add(instrument)
              else next.delete(instrument)
              return next
            })
          }
        />
        <HelpText>
          Tuning fields appear only for the instruments you play. You can change this any time in
          Settings.
        </HelpText>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <button
          type="button"
          className="btn btn-primary min-h-11 w-full"
          disabled={pending}
          onClick={() => run(() => setInstruments(db, userId, [...chosen]))}
        >
          Done
        </button>
      </div>
    </Sheet>
  )
}
