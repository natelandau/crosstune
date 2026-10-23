import { INSTRUMENTS } from '../../../api/vocabulary'
import { INSTRUMENT_LABELS } from '../../../constants'
import { INSTRUMENTS_HELP } from '../../../domain/instruments'
import { INSTRUMENTS as INSTRUMENTS_HEADER } from '../settingsCopy'
import { useInstrumentsSetting } from '../useInstrumentsSetting'
import { Group } from '../../../ui/form/Group'
import { Switch } from '../../../ui/form/Switch'
import { SETTINGS_GROUPS } from '../settingsPaths'
import { PendingGroup } from '../PendingGroup'

/** A switch for each instrument, which decide the tuning fields a tune shows. */
export function InstrumentsGroup() {
  const { instruments, toggle, error } = useInstrumentsSetting()
  if (!instruments) return <PendingGroup />
  return (
    <Group
      id={SETTINGS_GROUPS.instruments}
      header={INSTRUMENTS_HEADER}
      help={INSTRUMENTS_HELP}
      error={error ?? undefined}
    >
      {INSTRUMENTS.map((instrument) => (
        <Switch
          key={instrument}
          label={INSTRUMENT_LABELS[instrument]}
          isSelected={instruments.has(instrument)}
          onChange={(on) => toggle(instrument, on)}
        />
      ))}
    </Group>
  )
}
