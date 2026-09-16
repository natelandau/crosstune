import { INSTRUMENTS, type Instrument } from '../../db/types'
import { INSTRUMENT_LABELS } from './instruments'

/** One checkbox per instrument, the same control on the settings screen and the first-run prompt. */
export function InstrumentPicker({
  label,
  value,
  onToggle,
}: {
  /** Names the group for assistive tech; the screen shows its own heading. */
  label: string
  value: ReadonlySet<Instrument>
  onToggle: (instrument: Instrument, on: boolean) => void
}) {
  return (
    <fieldset className="fieldset">
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {INSTRUMENTS.map((instrument) => (
          <label key={instrument} className="label min-h-11 cursor-pointer gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={value.has(instrument)}
              onChange={(e) => onToggle(instrument, e.target.checked)}
            />
            {INSTRUMENT_LABELS[instrument]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
