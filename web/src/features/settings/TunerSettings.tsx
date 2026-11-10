import { USER_SETTINGS_RANGES } from '../../api/vocabulary'
import { FIELD_LABEL, FIELD_ROW } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { Stepper } from '../../ui/Stepper'
import {
  a4Value,
  LOWER_REFERENCE_PITCH,
  RAISE_REFERENCE_PITCH,
  REFERENCE_PITCH,
} from './settingsCopy'
import { useTunerSettings } from './useTunerSettings'

const { min: MIN_HZ, max: MAX_HZ } = USER_SETTINGS_RANGES.tuner_a4_hz

/** The reference pitch, stepped one hertz at a time between its bounds. */
export function TunerSettings() {
  const { a4, setA4 } = useTunerSettings()
  return (
    <Group>
      <div className={FIELD_ROW}>
        <span className={FIELD_LABEL}>{REFERENCE_PITCH}</span>
        <span className="flex min-w-0 flex-1 justify-end">
          <Stepper
            label={REFERENCE_PITCH}
            value={a4}
            min={MIN_HZ}
            max={MAX_HZ}
            format={a4Value}
            decrementLabel={LOWER_REFERENCE_PITCH}
            incrementLabel={RAISE_REFERENCE_PITCH}
            onChange={setA4}
          />
        </span>
      </div>
    </Group>
  )
}
