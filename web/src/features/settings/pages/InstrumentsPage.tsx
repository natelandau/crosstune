import { INSTRUMENTS } from '../../../api/vocabulary'
import { INSTRUMENT_LABELS } from '../../../constants'
import { INSTRUMENTS_HELP } from '../instruments'
import { useInstrumentsSetting } from '../useInstrumentsSetting'
import { Group } from '../../../ui/form/Group'
import { Switch } from '../../../ui/form/Switch'

/** A switch for each instrument, which decide the tuning fields a tune shows. */
export function InstrumentsPage() {
  const { instruments, toggle, error } = useInstrumentsSetting()
  if (!instruments) return null
  return (
    <Group footer={INSTRUMENTS_HELP} error={error ?? undefined}>
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
