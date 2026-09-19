import { useAuthSession } from '../../auth/AuthContext'
import { toggleInstrumentSetting } from '../../commands/settings'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { Group } from '../../ui/Group'
import { InstrumentRows } from './InstrumentRows'
import { useInstruments } from './useInstruments'

/**
 * The instruments a musician plays, which decide the tuning fields a song shows. Each tap writes
 * its own toggle rather than the whole set, so two taps in a row both land.
 */
export function InstrumentsGroup() {
  const db = useDb()
  const { userId } = useAuthSession()
  const instruments = useInstruments()
  const action = useAction()

  if (!instruments) return null

  return (
    <Group
      header="Instruments"
      footer="Tuning fields appear only for the instruments you play."
      error={action.error}
    >
      <InstrumentRows
        value={instruments}
        onToggle={(instrument, on) =>
          action.run(() => toggleInstrumentSetting(db, userId, instrument, on))
        }
      />
    </Group>
  )
}
