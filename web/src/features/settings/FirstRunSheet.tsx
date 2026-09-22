import { IonButton } from '@ionic/react'
import { useEffect, useRef, useState } from 'react'
import type { Instrument } from '../../api/vocabulary'
import { useAuthSession } from '../../auth/AuthContext'
import { setInstruments } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import { storedInstruments } from '../../db/types'
import { useLastSyncedAt } from '../../sync/SyncProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { useRecord } from '../recording/useRecord'
import { InstrumentRows } from './InstrumentRows'
import { INSTRUMENTS_HELP } from './instruments'
import { useSettingsRow } from './useSettingsRow'

// The sync status can announce a clean run a beat before the live query delivers the row that
// run pulled, so the question waits this long to be sure the row is really absent.
export const FIRST_RUN_GRACE_MS = 750

export const FIRST_RUN_TITLE = 'Which instruments do you play?'
export const FIRST_RUN_HELP = `${INSTRUMENTS_HELP} You can change this any time in Settings.`

const NONE: ReadonlySet<Instrument> = new Set()

/**
 * Asks a new account which instruments it plays and writes the settings row, so the violin-only
 * default is only ever a placeholder. It opens once the first clean sync of the session has run
 * and found no row: a new device for an existing account has no row until that pull, and an
 * offline session never syncs, so neither is asked. Nothing is chosen to begin with, so an
 * answer of none is an answer rather than the default in disguise.
 */
export function FirstRunSheet() {
  const db = useDb()
  const { userId, offline } = useAuthSession()
  const row = useSettingsRow()
  const syncedAt = useLastSyncedAt()
  const { recording } = useRecord()
  const [chosen, setChosen] = useState<ReadonlySet<Instrument>>(NONE)
  const { clear, error, pending, run } = useAction()
  // Two Done presses in one tick both read the same committed state.
  const saving = useRef(false)

  const missing =
    !offline &&
    !recording &&
    syncedAt !== null &&
    row !== undefined &&
    storedInstruments(row) === null

  const [graceOver, setGraceOver] = useState(false)
  const [asking, setAsking] = useState(missing)
  if (asking !== missing) {
    setAsking(missing)
    // Each question starts over: the grace guards the pull that took the last answer away just
    // as much as the first one, and an answer already given, or a rejection of one, belongs to
    // the question it was made under.
    if (!missing) {
      setGraceOver(false)
      setChosen(NONE)
      clear()
    }
  }

  useEffect(() => {
    if (!missing) return
    const timer = setTimeout(() => setGraceOver(true), FIRST_RUN_GRACE_MS)
    return () => clearTimeout(timer)
  }, [missing])

  const submit = () => {
    if (saving.current) return
    saving.current = true
    run(() =>
      // This sheet outlives every answer it takes, so the guard is released either way: a refusal
      // leaves the question up, and a later pull can ask it again.
      setInstruments(db, userId, [...chosen]).finally(() => {
        saving.current = false
      }),
    )
  }

  return (
    <Sheet
      open={missing && graceOver}
      title={FIRST_RUN_TITLE}
      dismissible={false}
      // The stored answer is what closes this sheet, so a close has nothing left to report. A
      // dismissal from outside the component would hide the modal with `open` still true, which
      // Ionic never re-presents; nothing dismisses it from outside.
      onClose={() => {}}
      end={
        <IonButton strong disabled={pending} onClick={submit}>
          Done
        </IonButton>
      }
    >
      <Group footer={FIRST_RUN_HELP} error={error}>
        <InstrumentRows
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
      </Group>
    </Sheet>
  )
}
