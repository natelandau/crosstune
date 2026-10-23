import { Minus, Plus } from 'lucide-react'
import { useId, useRef } from 'react'
import { USER_SETTINGS_RANGES } from '../../api/vocabulary'
import { Button } from '../../ui/Button'
import { FIELD_LABEL, FIELD_ROW } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import {
  a4Label,
  LOWER_REFERENCE_PITCH,
  RAISE_REFERENCE_PITCH,
  REFERENCE_PITCH,
} from './settingsCopy'
import { useTunerSettings } from './useTunerSettings'

const { min: MIN_HZ, max: MAX_HZ } = USER_SETTINGS_RANGES.tuner_a4_hz

/** The reference pitch, stepped one hertz at a time between its bounds. */
export function TunerSettings() {
  const { a4, setA4 } = useTunerSettings()
  const labelId = useId()
  const lower = useRef<HTMLButtonElement>(null)
  const raise = useRef<HTMLButtonElement>(null)
  // A step that reaches a bound disables its own button, so focus moves to the other one
  // rather than falling to the page.
  const step = (next: number) => {
    setA4(next)
    if (next <= MIN_HZ) raise.current?.focus()
    if (next >= MAX_HZ) lower.current?.focus()
  }
  return (
    <Group>
      <div className={FIELD_ROW}>
        <span id={labelId} className={FIELD_LABEL}>
          {REFERENCE_PITCH}
        </span>
        <span
          role="group"
          aria-labelledby={labelId}
          className="flex min-w-0 flex-1 items-center justify-end gap-1"
        >
          <Button
            ref={lower}
            icon={Minus}
            iconOnly
            label={LOWER_REFERENCE_PITCH}
            isDisabled={a4 <= MIN_HZ}
            onPress={() => step(a4 - 1)}
          />
          <output className="t-body text-ink-2 min-w-24 text-center tabular-nums">
            {a4Label(a4)}
          </output>
          <Button
            ref={raise}
            icon={Plus}
            iconOnly
            label={RAISE_REFERENCE_PITCH}
            isDisabled={a4 >= MAX_HZ}
            onPress={() => step(a4 + 1)}
          />
        </span>
      </div>
    </Group>
  )
}
