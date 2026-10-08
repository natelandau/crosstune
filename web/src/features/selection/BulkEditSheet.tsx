import { useId, useState } from 'react'
import { MODES, STATUSES, TIME_SIGNATURES, type Instrument } from '../../api/vocabulary'
import type { BulkPatch } from '../../commands/bulk'
import { INSTRUMENT_LABELS, STATUS_LABELS } from '../../constants'
import type { CatalogEntry } from '../catalog/filters'
import {
  EDIT_FIELD_LABELS,
  FIELD_KINDS,
  type EditField,
  type Summary,
  type TouchedValue,
} from './batchEdit'
import { EDIT_ONLY_CHANGED, editTunesTitle, MIXED, NO, SAVE_EDIT, YES } from './selectionCopy'
import { EDIT_LIMITS, editRowValue, useBulkEdit, type BulkEdit } from './useBulkEdit'
import { tuningLabel } from '../../domain/instruments'
import { DETAILS_HEADER, STATUS_HEADER, TUNING_HEADER } from '../tune/tuneFormCopy'
import {
  learnedOnDate,
  learnedOnError,
  learnedOnParts,
  learnedOnRefusedPart,
  learnedOnText,
} from '../tune/tuneFormValues'
import { NOT_SET } from '../../ui/fieldCopy'
import { KEY } from '../../ui/keyName'
import type { DateParts } from '../../ui/partialDate'
import { ErrorLine } from '../../ui/ErrorLine'
import { Group } from '../../ui/form/Group'
import { PartialDateField } from '../../ui/form/PartialDateField'
import { Picker, type PickerOption } from '../../ui/form/Picker'
import { SuggestField } from '../../ui/form/SuggestField'
import { KeyGrid } from '../../ui/KeyGrid'
import { Sheet } from '../../ui/Sheet'
import { useEndOnClose } from '../../ui/useEndOnClose'

// No option can be this: options are stored values, which never hold a NUL.
const CLEAR = '\u0000clear'

const asOptions = (values: readonly string[]): PickerOption[] =>
  values.map((value) => ({ id: value, label: value }))

const CLOSED: Partial<Record<EditField, PickerOption[]>> = {
  status: STATUSES.map((status) => ({ id: status, label: STATUS_LABELS[status] })),
  mode: asOptions(MODES),
  time_signature: asOptions(TIME_SIGNATURES),
  is_crooked: asOptions([YES, NO]),
}

/** What an untouched row reads when no one value stands for every tune. */
const blankLabel = (summary: Summary) => (summary.kind === 'mixed' ? MIXED : NOT_SET)

/**
 * The tune form's fields over many tunes at once, as a full-height sheet on touch and a dialog
 * on pointer. Each row reads the value every tune shares, Not set, or Mixed, and only a row the
 * musician touches is written.
 */
export function BulkEditSheet(props: {
  isOpen: boolean
  /** The selected tunes, in screen order. */
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
  // Each open is a fresh body, so a date half typed in one open never reaches the next.
  const [opens, setOpens] = useState(props.isOpen ? 1 : 0)
  const [wasOpen, setWasOpen] = useState(props.isOpen)
  if (props.isOpen !== wasOpen) {
    setWasOpen(props.isOpen)
    if (props.isOpen) setOpens((count) => count + 1)
  }
  return <BulkEditBody key={opens} {...props} />
}

function BulkEditBody({
  isOpen,
  entries,
  instruments,
  error,
  pending,
  onCancel,
  onApply,
}: Parameters<typeof BulkEditSheet>[0]) {
  const bulk = useBulkEdit({ open: isOpen, entries, instruments, pending, onApply, onCancel })
  const { summaries, touched, touch, tunings, details } = bulk
  useEndOnClose(bulk.closing, bulk.dismissed)
  // A date half typed writes nothing yet, so the sheet holds it by this rather than by a touch.
  const [dating, setDating] = useState(false)
  const row = (field: EditField) => <EditRow key={field} field={field} bulk={bulk} />
  return (
    <Sheet
      isOpen={isOpen && !bulk.closing}
      onOpenChange={(open) => {
        if (!open) bulk.cancel()
      }}
      title={editTunesTitle(entries.length)}
      height="full"
      locked={bulk.touchedCount > 0 || dating || pending}
      primary={{ label: SAVE_EDIT, onPress: bulk.save, isDisabled: !bulk.canSave }}
    >
      <div className="pb-4">
        <p className="t-secondary text-ink-2 px-4 pt-3">{EDIT_ONLY_CHANGED}</p>
        <ErrorLine error={error} place="sheet" />
        <Group header={STATUS_HEADER}>{row('status')}</Group>
        <Group header={KEY} plain>
          <KeyRow summary={summaries.key} touched={touched.key} onTouch={(v) => touch('key', v)} />
        </Group>
        {tunings.length > 0 && (
          <Group header={TUNING_HEADER}>
            {tunings.map(({ field, instrument }) => (
              <EditRow
                key={field}
                field={field}
                bulk={bulk}
                label={tuningLabel(instrument)}
                rowLabel={INSTRUMENT_LABELS[instrument]}
              />
            ))}
          </Group>
        )}
        <Group header={DETAILS_HEADER}>
          {details.filter((field) => FIELD_KINDS[field] !== 'date').map(row)}
        </Group>
        {details.includes('learned_on') && (
          <DateRow
            summary={summaries.learned_on}
            touched={touched.learned_on}
            onTouch={(value) => touch('learned_on', value)}
            onDrafting={setDating}
          />
        )}
      </div>
    </Sheet>
  )
}

/** Says Mixed under a control that cannot say it in place. */
const footerFor = (summary: Summary) => (summary.kind === 'mixed' ? MIXED : undefined)

/**
 * One field as a picker for a closed choice or a suggestion field for an open one. Where the
 * tunes disagree the empty choice reads Mixed and keeps each tune's value, and Not set is a
 * choice of its own for a field that can be cleared.
 */
function EditRow({
  field,
  bulk,
  label = EDIT_FIELD_LABELS[field],
  rowLabel,
}: {
  field: EditField
  bulk: BulkEdit
  label?: string
  rowLabel?: string
}) {
  const summary = bulk.summaries[field]
  const touched = bulk.touched[field]
  const touch = (value: TouchedValue | undefined) => bulk.touch(field, value)
  const mixed = summary.kind === 'mixed'
  const value = editRowValue(summary, touched)
  const closed = CLOSED[field]

  if (closed) {
    const boolean = FIELD_KINDS[field] === 'boolean'
    // Status is always set and a yes or no column takes no null, so neither can be cleared.
    const clearable = !boolean && field !== 'status'
    const offerClear = clearable && mixed
    const chosen =
      typeof value === 'boolean'
        ? value
          ? YES
          : NO
        : value
          ? value
          : offerClear && touched !== undefined
            ? CLEAR
            : null
    return (
      <Picker
        label={label}
        value={chosen}
        options={offerClear ? [{ id: CLEAR, label: NOT_SET }, ...closed] : closed}
        emptyLabel={blankLabel(summary)}
        onChange={(id) => {
          if (id === null) touch(clearable && !mixed ? null : undefined)
          else if (id === CLEAR) touch(null)
          else touch(boolean ? id === YES : id)
        }}
      />
    )
  }

  const pick = bulk.picks[field]
  return (
    <SuggestField
      label={label}
      rowLabel={rowLabel}
      value={typeof value === 'string' ? value : ''}
      suggestions={pick?.options ?? []}
      maxLength={EDIT_LIMITS[field]}
      keep={
        mixed
          ? { label: MIXED, kept: touched === undefined, onKeep: () => touch(undefined) }
          : undefined
      }
      onChange={touch}
    />
  )
}

/**
 * The key as the tune form's grid. Where the tunes disagree its empty choice reads Mixed and
 * keeps each tune's key; once a key is picked, pressing it again clears every tune's key.
 */
function KeyRow({
  summary,
  touched,
  onTouch,
}: {
  summary: Summary
  touched: TouchedValue | undefined
  onTouch: (value: TouchedValue | undefined) => void
}) {
  const value = editRowValue(summary, touched)
  const kept = touched === undefined && summary.kind === 'mixed'
  return (
    <KeyGrid
      value={typeof value === 'string' && value !== '' ? value : null}
      anyLabel={kept ? MIXED : NOT_SET}
      onChange={(key) => onTouch(key === null && kept ? undefined : key)}
    />
  )
}

/**
 * Learned on, a part at a time. Only a whole date, or none, is written, so a date still being
 * typed leaves the field as it was.
 */
function DateRow({
  summary,
  touched,
  onTouch,
  onDrafting,
}: {
  summary: Summary
  touched: TouchedValue | undefined
  onTouch: (value: TouchedValue | undefined) => void
  /** Whether the date shown differs from the one the sheet opened with. */
  onDrafting: (drafting: boolean) => void
}) {
  const errorId = useId()
  const shared = summary.kind === 'shared' && typeof summary.value === 'string' ? summary.value : ''
  const [draft, setDraft] = useState<DateParts>(() => learnedOnParts(shared))
  const [initial] = useState(() => learnedOnText(learnedOnParts(shared)))
  const [left, setLeft] = useState(false)
  const text = learnedOnText(draft)
  const refused = learnedOnRefusedPart(text)
  const error = left ? learnedOnError(text) : null
  return (
    <Group
      header={EDIT_FIELD_LABELS.learned_on}
      footer={touched === undefined ? footerFor(summary) : undefined}
      error={error ?? undefined}
      errorId={errorId}
    >
      <PartialDateField
        whole
        value={draft}
        refusedPart={error ? refused : null}
        describedBy={errorId}
        onLeave={() => setLeft(true)}
        onChange={(parts) => {
          setDraft(parts)
          const next = learnedOnText(parts)
          onDrafting(next !== initial)
          if (next === '') onTouch(null)
          else if (learnedOnRefusedPart(next) === null) onTouch(learnedOnDate(next))
          else onTouch(undefined)
        }}
      />
    </Group>
  )
}
