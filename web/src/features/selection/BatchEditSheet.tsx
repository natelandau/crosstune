import { useState, type FormEvent } from 'react'
import type { BulkPatch } from '../../commands/bulk'
import { ChoiceChips } from '../../components/ChoiceChips'
import { Sheet } from '../../components/Sheet'
import { MODES, STATUSES, TIME_SIGNATURES, type Instrument } from '../../db/types'
import type { CatalogEntry } from '../catalog/filters'
import { isSongStatus, STATUS_LABELS } from '../catalog/StatusDot'
import { SONG_LIMITS } from '../song/limits'
import { FEELS, GENRES, KEYS, PART_STRUCTURES, TUNING_SUGGESTIONS } from '../song/suggestions'
import {
  describeChanges,
  displayValue,
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

const CHOICES: Partial<Record<EditField, readonly string[]>> = {
  status: STATUSES,
  key: KEYS,
  mode: MODES,
  violin_tuning: TUNING_SUGGESTIONS.violin_tuning,
  banjo_tuning: TUNING_SUGGESTIONS.banjo_tuning,
  genre: GENRES,
  feel: FEELS,
  time_signature: TIME_SIGNATURES,
  part_structure: PART_STRUCTURES,
}

/** Fields whose vocabulary is only a suggestion, so an Other… chip accepts any value. */
const OPEN_FIELDS: ReadonlySet<EditField> = new Set([
  'key',
  'violin_tuning',
  'banjo_tuning',
  'genre',
  'feel',
  'part_structure',
])

const LIMITS = SONG_LIMITS as Partial<Record<EditField, number>>

// A sentinel no real option can take, so the "No value" chip is distinct from an empty value.
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

  if (kind === 'choice') {
    // The chips show only a pending change: nothing pressed keeps every song as it is, and
    // the value the songs share reads beside the field's label instead.
    const shown = value === null ? CLEAR : typeof value === 'string' ? value : ''
    const clearable = field !== 'status'
    const options = CHOICES[field] ?? []
    return (
      <ChoiceChips
        label={label}
        value={shown}
        options={clearable ? [...options, CLEAR] : options}
        optionLabel={(option) => {
          if (option === CLEAR) return 'No value'
          return field === 'status' && isSongStatus(option) ? STATUS_LABELS[option] : option
        }}
        other={OPEN_FIELDS.has(field)}
        maxLength={LIMITS[field]}
        onChange={(next) => onChange(next === '' ? undefined : next === CLEAR ? null : next)}
        // A tap that lands on what the songs already hold is no change. Typing never
        // settles, so a typed value that happens to match stays a visible change rather
        // than vanishing from the input mid-edit.
        onCommit={(next) => {
          const settled = next === CLEAR ? null : next
          if (settled !== '' && isUnchanged(summary, settled)) onChange(undefined)
        }}
      />
    )
  }

  const text =
    typeof value === 'string'
      ? value
      : value === null
        ? ''
        : typeof shared === 'string'
          ? shared
          : ''

  if (kind === 'date') {
    return (
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
    )
  }

  return (
    <input
      className="input w-full"
      type="text"
      aria-label={label}
      maxLength={LIMITS[field]}
      value={text}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** What the label row says the songs hold now: a choice field's shared value, or Mixed. */
function currentLabel(field: EditField, summary: Summary): string | null {
  if (summary.kind === 'mixed') return 'Mixed'
  if (summary.kind === 'shared' && FIELD_KINDS[field] === 'choice') {
    return displayValue(field, summary.value)
  }
  return null
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
      // Yes or No stays marked even when it matches, so the choice does not snap back to
      // Keep; a choice field settles that question itself, since only a tap can match.
      const kind = FIELD_KINDS[field]
      const untouched =
        value === undefined ||
        ((kind === 'text' || kind === 'date') && isUnchanged(summaries[field], value))
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
      <p className="text-meta -mt-2 mb-2 opacity-70">Only fields you change are saved.</p>
      <form className="space-y-1" onSubmit={submit} noValidate>
        {fields.map((field) => {
          const value = touched[field]
          const state = value === undefined ? null : touchState(value)
          const current = state ? null : currentLabel(field, summaries[field])
          return (
            // Every control names itself, so no fieldset wraps it: a legend would give a
            // second group the field's name beside the chips' own.
            <div
              key={field}
              className={`rounded-box space-y-2 px-2 py-2 transition-[background-color,box-shadow] duration-(--select-tint-duration) ${
                state ? 'bg-accent/10 ring-accent ring-1' : ''
              }`}
            >
              <div className="flex min-h-11 items-center gap-2">
                <span className="text-label">{EDIT_FIELD_LABELS[field]}</span>
                {current ? (
                  <span className="text-meta font-normal tabular-nums opacity-70">{current}</span>
                ) : null}
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
              </div>
              <Control
                field={field}
                summary={summaries[field]}
                value={value}
                onChange={(next) => touch(field, next)}
              />
            </div>
          )
        })}
        {pending > 0 ? (
          <p className="rounded-box border-base-content/20 text-meta border px-3 py-2">
            {describeChanges(touched)}
          </p>
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
