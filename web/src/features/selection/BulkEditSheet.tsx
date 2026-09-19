import { IonButton, IonInput, IonItem, IonSelect, IonSelectOption } from '@ionic/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BulkPatch } from '../../commands/bulk'
import { MODES, STATUSES, TIME_SIGNATURES, type Instrument } from '../../db/types'
import { usePointer } from '../../platform/pointer'
import { FieldRow } from '../../ui/FieldRow'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { Sheet } from '../../ui/Sheet'
import type { CatalogEntry } from '../catalog/filters'
import { STATUS_LABELS } from '../catalog/status'
import { TUNING_FIELD_NAMES, TUNING_FIELDS, type TuningField } from '../settings/instruments'
import { SONG_LIMITS } from '../song/limits'
import { FEELS, GENRES, PART_STRUCTURES, QUICK_KEYS, TUNING_SUGGESTIONS } from '../song/suggestions'
import { SuggestSelect } from '../song/SuggestSelect'
import {
  EDIT_FIELD_LABELS,
  FIELD_KINDS,
  isUnchanged,
  summarize,
  toPatch,
  visibleEditFields,
  type EditField,
  type Summary,
  type Touched,
  type TouchedValue,
} from './batchEdit'
import { countSongs } from './copy'

const PICKS: Partial<Record<EditField, { options: readonly string[]; other: boolean }>> = {
  key: { options: QUICK_KEYS, other: true },
  mode: { options: MODES, other: false },
  violin_tuning: { options: TUNING_SUGGESTIONS.violin_tuning, other: true },
  banjo_tuning: { options: TUNING_SUGGESTIONS.banjo_tuning, other: true },
  genre: { options: GENRES, other: true },
  feel: { options: FEELS, other: true },
  time_signature: { options: TIME_SIGNATURES, other: false },
  part_structure: { options: PART_STRUCTURES, other: true },
}

// A toggle cannot show a third state, so a yes or no field is picked from a list. Its empty
// choice keeps every song as it is rather than clearing them: the column takes no null.
const YES_NO = ['Yes', 'No']

const LIMITS = SONG_LIMITS as Partial<Record<EditField, number>>

function isTuning(field: EditField): field is TuningField {
  return (TUNING_FIELD_NAMES as readonly string[]).includes(field)
}

/** The touched value once the row is touched, the shared value when every song agrees, else none. */
function rowValue(summary: Summary, touched: TouchedValue | undefined): TouchedValue {
  if (touched !== undefined) return touched
  return summary.kind === 'shared' ? summary.value : null
}

function StatusRow({
  summary,
  touched,
  onChange,
}: {
  summary: Summary
  touched: TouchedValue | undefined
  onChange: (value: TouchedValue) => void
}) {
  const mouse = usePointer() === 'mouse'
  const value = rowValue(summary, touched)
  return (
    <IonItem>
      {/* Status can be set but never cleared, so this row carries no empty choice. */}
      <IonSelect
        aria-label="Status"
        placeholder={summary.kind === 'mixed' ? 'Mixed' : 'Not set'}
        interface={mouse ? 'popover' : 'action-sheet'}
        value={typeof value === 'string' ? value : ''}
        onIonChange={(event) => onChange(String(event.detail.value ?? ''))}
      >
        {STATUSES.map((status) => (
          <IonSelectOption key={status} value={status}>
            {STATUS_LABELS[status]}
          </IonSelectOption>
        ))}
      </IonSelect>
    </IonItem>
  )
}

function EditRow({
  field,
  summary,
  touched,
  showLabel,
  onChange,
}: {
  field: EditField
  summary: Summary
  touched: TouchedValue | undefined
  /** False when a group header above already names the field. */
  showLabel: boolean
  /** Undefined leaves the row untouched, so nothing is written for this field. */
  onChange: (value: TouchedValue | undefined) => void
}) {
  if (field === 'status')
    return <StatusRow summary={summary} touched={touched} onChange={onChange} />

  const label = EDIT_FIELD_LABELS[field]
  const placeholder = summary.kind === 'mixed' ? 'Mixed' : 'Not set'
  const detail = showLabel ? label : undefined
  const value = rowValue(summary, touched)
  const text = typeof value === 'string' ? value : ''
  const kind = FIELD_KINDS[field]

  if (kind === 'boolean') {
    return (
      <SuggestSelect
        label={label}
        showLabel={showLabel}
        detail={detail}
        value={value === true ? 'Yes' : value === false ? 'No' : ''}
        options={YES_NO}
        other={false}
        placeholder={placeholder}
        emptyLabel="Keep"
        onChange={(next) => onChange(next === '' ? undefined : next === 'Yes')}
      />
    )
  }

  if (kind === 'date') {
    return (
      <FieldRow label={label} detail={detail}>
        <IonInput
          type="date"
          aria-label={label}
          className="ms-auto text-end"
          // A date input shows its own format in place of a placeholder, so the one row that
          // cannot say Mixed where it stands says it underneath.
          helperText={summary.kind === 'mixed' ? 'Mixed' : undefined}
          value={text}
          onIonInput={(event) => {
            const typed = event.detail.event?.target
            // A date reads as empty until every part of it is filled, and taking that for a
            // clear would wipe the field on every selected song halfway through typing one.
            if (typed instanceof HTMLInputElement && typed.validity.badInput) return
            onChange(String(event.detail.value ?? ''))
          }}
        />
      </FieldRow>
    )
  }

  if (kind === 'text') {
    return (
      <FieldRow label={label} detail={detail}>
        <IonInput
          aria-label={label}
          className="ms-auto text-end"
          placeholder={placeholder}
          maxlength={LIMITS[field]}
          value={text}
          onIonInput={(event) => onChange(String(event.detail.value ?? ''))}
        />
      </FieldRow>
    )
  }

  const pick = PICKS[field]!
  return (
    <SuggestSelect
      label={label}
      showLabel={showLabel}
      detail={detail}
      value={text}
      options={pick.options}
      other={pick.other}
      maxLength={LIMITS[field]}
      placeholder={placeholder}
      emptyLabel="Clear"
      clearOnOther={false}
      onChange={onChange}
    />
  )
}

/**
 * The song form's own Details list over many songs at once. Each row reads the value every
 * selected song shares, Not set when they are all empty, or Mixed when they disagree; only a
 * row the musician touches is written.
 */
export function BulkEditSheet({
  open,
  entries,
  instruments,
  error,
  pending,
  onCancel,
  onApply,
}: {
  open: boolean
  /** The selected songs, in screen order. */
  entries: readonly CatalogEntry[]
  instruments: ReadonlySet<Instrument>
  /** The caller's failed write. The sheet stays open so the edit can be tried again. */
  error: string | null
  /** True while the caller's write runs. */
  pending: boolean
  /** The sheet closed without applying anything. */
  onCancel: () => void
  /** Hands the caller the patch; the caller writes it and closes the sheet. */
  onApply: (patch: BulkPatch) => void
}) {
  const [touched, setTouched] = useState<Touched>({})
  const [closing, setClosing] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  const [session, setSession] = useState(0)
  // The session the sheet was presented for. Every way out ends here, including Escape, a
  // backdrop tap, a drag to the bottom, and the Android back button, which dismiss with the
  // backdrop role rather than through `closing`.
  const presentedFor = useRef<number | null>(null)
  // Two submits in one tick both read the same committed `pending`, so the guard is a ref.
  const applied = useRef(false)

  // Reset during render, not in an effect, so the sheet's first frame is already clean rather
  // than flashing the previous session's values.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTouched({})
      setClosing(false)
      setSession((current) => current + 1)
    }
  }

  // Lifted once the caller reports the write settled, so a failed edit can be tried again.
  useEffect(() => {
    if (!pending) applied.current = false
  })

  useEffect(() => {
    if (open) presentedFor.current = session
  }, [open, session])

  const summaries = useMemo(() => summarize(entries), [entries])
  const fields = useMemo(() => visibleEditFields(entries, instruments), [entries, instruments])

  const touch = (field: EditField, value: TouchedValue | undefined) => {
    setTouched((current) => {
      const next = { ...current }
      if (value === undefined || isUnchanged(summaries[field], value)) delete next[field]
      else next[field] = value
      return next
    })
  }

  const touchedCount = Object.keys(touched).length

  const save = () => {
    if (pending || closing || applied.current || touchedCount === 0) return
    applied.current = true
    onApply(toPatch(touched))
  }

  const dismissed = () => {
    const presented = presentedFor.current
    presentedFor.current = null
    // A dismissal that ends after the caller closed the sheet, or after a later session
    // opened, belongs to a session that is already gone.
    if (presented !== null && presented !== (open ? session : null)) return
    onCancel()
  }

  const row = (field: EditField, showLabel: boolean) => (
    <EditRow
      key={field}
      field={field}
      summary={summaries[field]}
      touched={touched[field]}
      showLabel={showLabel}
      onChange={(value) => touch(field, value)}
    />
  )

  const tunings = TUNING_FIELD_NAMES.filter((field) => fields.includes(field))
  const details = fields.filter(
    (field) => field !== 'status' && field !== 'key' && !isTuning(field),
  )

  return (
    <Sheet
      open={open && !closing}
      title={`Edit ${countSongs(entries.length)}`}
      dismissible={!pending}
      onClose={dismissed}
      start={
        <IonButton disabled={pending} onClick={() => setClosing(true)}>
          Cancel
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || closing || touchedCount === 0} onClick={save}>
          Save
        </IonButton>
      }
    >
      <div className="pb-8">
        <p className="type-footnote px-8 pt-3">Only fields you change are saved.</p>
        {error ? <InlineError className="px-8 pt-3">{error}</InlineError> : null}
        <Group header="Status">{row('status', false)}</Group>
        <Group header="Key">{row('key', false)}</Group>
        {tunings.map((field) => (
          <Group key={field} header={TUNING_FIELDS[field].label}>
            {row(field, false)}
          </Group>
        ))}
        <Group header="Details">{details.map((field) => row(field, true))}</Group>
      </div>
    </Sheet>
  )
}
