import { IonButton, IonItem, IonLabel } from '@ionic/react'
import { useState } from 'react'
import { INSTRUMENTS } from '../../api/vocabulary'
import { useAuthSession } from '../../auth/AuthContext'
import { toggleInstrumentSetting } from '../../commands/settings'
import { INSTRUMENT_LABELS } from '../../constants'
import { useDb } from '../../db/DbProvider'
import { NOT_SET } from '../../ui/FieldRow'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { InstrumentRows } from './InstrumentRows'
import { INSTRUMENTS_HELP } from './instruments'
import { useInstruments } from './useInstruments'

/**
 * The instruments a musician plays, which decide the tuning fields a song shows. The set is
 * named on the screen and chosen in a sheet, so nine rows a musician answers once do not take
 * half the settings screen. Each tap writes its own toggle rather than the whole set, so two
 * taps in a row both land.
 */
export function InstrumentsGroup() {
  const db = useDb()
  const { userId } = useAuthSession()
  const instruments = useInstruments()
  const { clear, error, run } = useAction()
  const [open, setOpen] = useState(false)
  // The sheet's rows stay mounted through its dismiss animation, so a refusal can only move to
  // the row once they are gone. `open` alone turns false as the animation starts, which would
  // put the same refusal in two alert regions at once.
  const [showing, setShowing] = useState(false)

  if (!instruments) return null

  const chosen = INSTRUMENTS.filter((instrument) => instruments.has(instrument))
  const summary = chosen.map((instrument) => INSTRUMENT_LABELS[instrument]).join(', ')

  return (
    <>
      <Group
        header="Instruments"
        footer={INSTRUMENTS_HELP}
        // While the sheet is up it holds the checkboxes, so a refusal reports there instead.
        error={showing ? null : error}
      >
        <IonItem
          button
          detail
          onClick={() => {
            clear()
            setShowing(true)
            setOpen(true)
          }}
        >
          {/* The header above names the row, and an ion-item forwards an aria-label only as a
              snapshot taken once, so the name is content a screen reader reads as it changes. */}
          <IonLabel className="truncate">
            <span className="sr-only">Instruments</span>
            {summary || NOT_SET}
          </IonLabel>
        </IonItem>
      </Group>
      <Sheet
        open={open}
        title="Instruments"
        onClose={() => {
          setOpen(false)
          setShowing(false)
        }}
        end={
          <IonButton strong onClick={() => setOpen(false)}>
            Done
          </IonButton>
        }
      >
        <Group error={error}>
          <InstrumentRows
            value={instruments}
            onToggle={(instrument, on) =>
              run(() => toggleInstrumentSetting(db, userId, instrument, on))
            }
          />
        </Group>
      </Sheet>
    </>
  )
}
