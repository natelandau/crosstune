import { Plus } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import { MODES, TUNE_LIMITS, type Instrument } from '../../api/vocabulary'
import { CAPO_FRETS, CAPO_INSTRUMENTS, INSTRUMENT_LABELS, TUNINGS } from '../../constants'
import { capoLabel, NO_CAPO, tuningLabel } from '../../domain/instruments'
import { NOT_SET } from '../../ui/fieldCopy'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import { Picker } from '../../ui/form/Picker'
import { asOptions } from '../../ui/form/pickerOptions'
import { SuggestField } from '../../ui/form/SuggestField'
import { ADD_PART_MODE, PART_MODE_LABELS } from './detailFields'
import { canAddPartMode, modeRows, type TuneFormValues, type TuningValues } from './tuneFormValues'

/**
 * One mode per part, then a row that adds the next part's while there is one to add. The tune
 * form and the key editor show the same rows.
 */
export function ModeRows({
  modes,
  onChange,
  onAdd,
}: {
  modes: TuneFormValues['modes']
  onChange: (index: number, mode: string) => void
  onAdd: () => void
}) {
  return (
    <>
      {modeRows(modes).map((mode, index) => (
        <Picker
          key={PART_MODE_LABELS[index]}
          label={PART_MODE_LABELS[index]!}
          value={mode || null}
          options={asOptions(MODES)}
          emptyLabel={NOT_SET}
          onChange={(value) => onChange(index, value ?? '')}
        />
      ))}
      {canAddPartMode(modes) && (
        <AriaButton onPress={onAdd} className={`${FIELD_ROW_PRESSABLE} text-ink font-medium`}>
          <Plus className="size-5 shrink-0" aria-hidden />
          {ADD_PART_MODE}
        </AriaButton>
      )}
    </>
  )
}

/** An instrument's tuning, with its capo for an instrument that takes one. */
export function TuningRows({
  instrument,
  entry,
  autoFocus = false,
  onChange,
  onPickTuning,
}: {
  instrument: Instrument
  entry: TuningValues | undefined
  autoFocus?: boolean
  onChange: (patch: Partial<TuningValues>) => void
  /** Called when the tuning is picked from its suggestions rather than typed. */
  onPickTuning?: (tuning: string) => void
}) {
  return (
    <>
      <SuggestField
        label={tuningLabel(instrument)}
        rowLabel={INSTRUMENT_LABELS[instrument]}
        value={entry?.tuning ?? ''}
        suggestions={TUNINGS[instrument]}
        maxLength={TUNE_LIMITS.tuning}
        autoFocus={autoFocus}
        onChange={(tuning) => onChange({ tuning })}
        onPick={onPickTuning}
      />
      {CAPO_INSTRUMENTS[instrument] && (
        <Picker
          label={capoLabel(instrument)}
          value={entry?.capo || null}
          options={asOptions(CAPO_FRETS)}
          emptyLabel={NO_CAPO}
          onChange={(capo) => onChange({ capo: capo ?? '' })}
        />
      )}
    </>
  )
}
