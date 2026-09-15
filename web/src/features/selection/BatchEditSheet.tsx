import { useState, type FormEvent } from 'react'
import type { BulkPatch } from '../../commands/bulk'
import { Sheet } from '../../components/Sheet'
import { MODES, STATUSES, TIME_SIGNATURES, type Instrument } from '../../db/types'
import type { CatalogEntry } from '../catalog/filters'
import { isSongStatus, STATUS_LABELS } from '../catalog/StatusDot'
import { SONG_LIMITS } from '../song/limits'
import { FEELS, GENRES, KEYS, PART_STRUCTURES, TUNING_SUGGESTIONS } from '../song/suggestions'
import {
  describeChanges,
  EDIT_FIELD_LABELS,
  FIELD_KINDS,
  isUnchanged,
  summarize,
  toPatch,
  touchState,
  visibleEditFields,
  type EditField,
  type Summary,
  type Touched,
  type TouchedValue,
} from './batchEdit'
import { countSongs } from './copy'

const SUGGESTIONS: Partial<Record<EditField, readonly string[]>> = {
  key: KEYS,
  violin_tuning: TUNING_SUGGESTIONS.violin_tuning,
  banjo_tuning: TUNING_SUGGESTIONS.banjo_tuning,
  genre: GENRES,
  feel: FEELS,
  part_structure: PART_STRUCTURES,
}

const OPTIONS: Partial<Record<EditField, readonly string[]>> = {
  status: STATUSES,
  mode: MODES,
  time_signature: TIME_SIGNATURES,
}

const LIMITS = SONG_LIMITS as Partial<Record<EditField, number>>

// A sentinel no real option can take, so "No value" is distinct from the unset placeholder.
const CLEAR = '__clear__'

function Control({
  field,
  summary,
  value,
  onChange,
}: {
  field: EditField
  summary: Summary
  value: TouchedValue | undefined
  onChange: (value: TouchedValue | undefined) => void
}) {
  const label = EDIT_FIELD_LABELS[field]
  const kind = FIELD_KINDS[field]
  const shared = summary.kind === 'shared' ? summary.value : null

  if (kind === 'boolean') {
    const choice = value === undefined ? 'keep' : value ? 'yes' : 'no'
    const options = [
      { id: 'keep', label: 'Keep', next: undefined },
      { id: 'yes', label: 'Yes', next: true },
      { id: 'no', label: 'No', next: false },
    ] as const
    return (
      <div className="join w-full" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <input
            key={option.id}
            type="radio"
            name={`bulk-${field}`}
            className="join-item btn btn-sm min-h-11 flex-1"
            aria-label={option.label}
            checked={choice === option.id}
            onChange={() => onChange(option.next)}
          />
        ))}
      </div>
    )
  }

  if (kind === 'select') {
    const selectValue =
      value === null
        ? CLEAR
        : typeof value === 'string'
          ? value
          : typeof shared === 'string'
            ? shared
            : ''
    return (
      <select
        className="select w-full"
        aria-label={label}
        value={selectValue}
        onChange={(event) => onChange(event.target.value === CLEAR ? null : event.target.value)}
      >
        <option value="" disabled>
          {summary.kind === 'mixed' ? 'Mixed' : 'Not set'}
        </option>
        {(OPTIONS[field] ?? []).map((option) => (
          <option key={option} value={option}>
            {field === 'status' && isSongStatus(option) ? STATUS_LABELS[option] : option}
          </option>
        ))}
        {field === 'status' ? null : <option value={CLEAR}>No value</option>}
      </select>
    )
  }

  const suggestions = SUGGESTIONS[field]
  const listId = suggestions ? `bulk-${field}-suggestions` : undefined
  const text =
    typeof value === 'string'
      ? value
      : value === null
        ? ''
        : typeof shared === 'string'
          ? shared
          : ''

  // Browsers ignore `placeholder` on a date input, so an untouched mixed date needs its own hint.
  if (kind === 'date') {
    const mixed = summary.kind === 'mixed' && value === undefined
    return (
      <div className="flex items-center gap-2">
        <input
          className="input w-full"
          type="date"
          aria-label={label}
          value={text}
          onChange={(event) => {
            // A half-typed date reports an empty string; ignore it rather than clear the field.
            if (event.target.validity.badInput) return
            onChange(event.target.value)
          }}
        />
        {mixed ? <span className="text-sm opacity-70">Mixed</span> : null}
      </div>
    )
  }

  return (
    <>
      <input
        className="input w-full"
        type="text"
        aria-label={label}
        list={listId}
        maxLength={LIMITS[field]}
        placeholder={summary.kind === 'mixed' ? 'Mixed' : undefined}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      {suggestions ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </>
  )
}

export function BatchEditSheet({
  open,
  entries,
  instruments,
  onClose,
  onApply,
}: {
  open: boolean
  entries: readonly CatalogEntry[]
  instruments: ReadonlySet<Instrument>
  onClose: () => void
  onApply: (patch: BulkPatch) => void
}) {
  const [touched, setTouched] = useState<Touched>({})
  const summaries = summarize(entries)
  const fields = visibleEditFields(entries, instruments)
  const pending = Object.keys(touched).length

  const touch = (field: EditField, value: TouchedValue | undefined) => {
    setTouched((current) => {
      const next = { ...current }
      // Yes or No stays marked even when it matches, so the choice does not snap back to Keep.
      const untouched =
        value === undefined ||
        (FIELD_KINDS[field] !== 'boolean' && isUnchanged(summaries[field], value))
      if (untouched) delete next[field]
      else next[field] = value
      return next
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pending > 0) onApply(toPatch(touched))
  }

  return (
    <Sheet open={open} title={`Edit ${countSongs(entries.length)}`} onClose={onClose}>
      <p className="-mt-2 mb-2 text-sm opacity-70">Only fields you change are saved.</p>
      <form className="space-y-1" onSubmit={submit} noValidate>
        {fields.map((field) => {
          const value = touched[field]
          const state = value === undefined ? null : touchState(value)
          return (
            <fieldset
              key={field}
              className={`fieldset rounded-box px-2 transition-[background-color,box-shadow] duration-(--select-tint-duration) ${
                state ? 'bg-accent/10 ring-accent ring-1' : ''
              }`}
            >
              <legend className="fieldset-legend flex w-full items-center gap-2">
                {EDIT_FIELD_LABELS[field]}
                {state ? (
                  <span className="badge badge-accent badge-sm">
                    {state === 'clear' ? 'will clear' : 'will change'}
                  </span>
                ) : null}
                <button
                  type="button"
                  className={`btn btn-ghost btn-xs ml-auto min-h-11 ${state ? '' : 'invisible'}`}
                  aria-label={`Undo ${EDIT_FIELD_LABELS[field]}`}
                  aria-hidden={state ? undefined : true}
                  tabIndex={state ? undefined : -1}
                  onClick={() => touch(field, undefined)}
                >
                  Undo
                </button>
              </legend>
              <Control
                field={field}
                summary={summaries[field]}
                value={value}
                onChange={(next) => touch(field, next)}
              />
            </fieldset>
          )
        })}
        {pending > 0 ? (
          <p className="bg-base-200 rounded-box px-3 py-2 text-sm">{describeChanges(touched)}</p>
        ) : null}
        <div className="flex gap-2 pt-2">
          <button type="button" className="btn min-h-11" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary min-h-11 flex-1"
            disabled={pending === 0}
          >
            Apply to {entries.length}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
