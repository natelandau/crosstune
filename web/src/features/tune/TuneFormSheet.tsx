import { Plus } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { MODES, TIME_SIGNATURES, TUNE_LIMITS } from '../../api/vocabulary'
import { CAPO_FRETS, CAPO_INSTRUMENTS, INSTRUMENT_LABELS, TUNINGS } from '../../constants'
import { capoLabel, NO_CAPO, tuningLabel } from '../../domain/instruments'
import {
  ADD_PART_MODE,
  DETAIL_FIELDS,
  DETAIL_LABELS,
  DETAILS_FOOTER,
  PART_MODE_LABELS,
} from './detailFields'
import {
  ADD_NEW_TUNE,
  DETAILS_HEADER,
  EDIT_TUNE_TITLE,
  NEW_TUNE_TITLE,
  LYRICS_PLACEHOLDER,
  NOTES_PLACEHOLDER,
  SAVE_TUNE,
  STATUS_HEADER,
  TITLE_FIELD,
  TUNE_TITLE_LABEL,
  TUNING_HEADER,
} from './tuneFormCopy'
import {
  asTimeSignature,
  canAddPartMode,
  learnedOnParts,
  learnedOnRefusedPart,
  learnedOnText,
  modeRows,
} from './tuneFormValues'
import { LYRICS_SECTION, NOTES_SECTION } from './tuneScreenCopy'
import { useTuneForm, type TuneForm } from './useTuneForm'
import { NOT_SET } from '../../ui/fieldCopy'
import { KEY } from '../../ui/keyName'
import { useLatest } from '../../ui/useLatest'
import { ErrorLine } from '../../ui/ErrorLine'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { PartialDateField } from '../../ui/form/PartialDateField'
import { Picker } from '../../ui/form/Picker'
import { StatusRail } from '../../ui/form/StatusRail'
import { SuggestField } from '../../ui/form/SuggestField'
import { Switch } from '../../ui/form/Switch'
import { TextField } from '../../ui/form/TextField'
import { KeyGrid } from '../../ui/KeyGrid'
import { Sheet } from '../../ui/Sheet'
import type { TuneFormOptions } from './formLauncher'

type FieldRef = HTMLInputElement & HTMLTextAreaElement

export interface TuneFormSheetProps extends TuneFormOptions {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called once a save lands, after the sheet asks to close. `dismissed` says the sheet was
   * closed while the save was running, so the musician has moved on from it.
   */
  onSaved?: (tuneId: string, result: { filingError?: string; dismissed: boolean }) => void
}

const asOptions = (values: readonly string[]) =>
  values.map((value) => ({ id: value, label: value }))

/**
 * A new tune, or an edit of one, as a full-height sheet on touch and a dialog on pointer.
 * Fields are ranked by use: title, status, key, tunings, notes, and lyrics, then the rarer
 * details.
 */
export function TuneFormSheet(props: TuneFormSheetProps) {
  // Each open is a fresh form, so nothing typed in one open reaches the next.
  const [opens, setOpens] = useState(props.isOpen ? 1 : 0)
  const [wasOpen, setWasOpen] = useState(props.isOpen)
  if (props.isOpen !== wasOpen) {
    setWasOpen(props.isOpen)
    if (props.isOpen) setOpens((count) => count + 1)
  }
  return <TuneFormBody key={opens} {...props} />
}

function TuneFormBody({
  isOpen,
  onOpenChange,
  source,
  tuneId,
  initialTitle,
  listId,
  recordingId,
  onSaved,
}: TuneFormSheetProps) {
  const titleRef = useRef<FieldRef>(null)
  const dateRef = useRef<HTMLDivElement>(null)
  const dateErrorId = useId()
  // Counts refused saves, so focus moves to the refused field on a save and never as one types.
  const [refusals, setRefusals] = useState(0)
  const closeRef = useLatest(() => onOpenChange(false))
  const onSavedRef = useLatest(onSaved)
  const isOpenRef = useLatest(isOpen)

  const form = useTuneForm({
    source,
    tuneId,
    initialTitle,
    listId,
    recordingId,
    enabled: isOpen,
    onSaved: (id, { filingError }) => {
      const dismissed = !isOpenRef.current
      if (!dismissed) closeRef.current()
      onSavedRef.current?.(id, { filingError, dismissed })
    },
  })
  const { values, set, errors } = form
  const errorsRef = useLatest(errors)

  useEffect(() => {
    if (refusals === 0) return
    if (errorsRef.current.title) titleRef.current?.focus()
    else if (errorsRef.current.learned_on) {
      dateRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"], button[data-invalid]')
        ?.focus()
    }
  }, [refusals, errorsRef])

  // An edit whose tune is deleted, here or on another device, has nothing left to save to.
  useEffect(() => {
    if (isOpen && form.missing) closeRef.current()
  }, [isOpen, form.missing, closeRef])

  const save = () => {
    if (form.save() === 'invalid') setRefusals((count) => count + 1)
  }

  const editing = tuneId !== undefined
  const typed = Object.values(form.touched).some(Boolean)
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={editing ? EDIT_TUNE_TITLE : NEW_TUNE_TITLE}
      height="full"
      locked={typed || form.pending}
      primary={{
        label: editing ? SAVE_TUNE : ADD_NEW_TUNE,
        onPress: save,
        isDisabled: !form.canSave,
      }}
    >
      {/* Shown while closing too, so the fields hold still as the sheet leaves. */}
      {(form.ready || !isOpen) && (
        <form
          noValidate
          className="pb-4"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          {/* A form with several fields submits on Enter only when it has a submit button. */}
          <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />
          <ErrorLine error={form.error} place="sheet" />

          {/* The sheet's title already says New tune or Edit tune, so a Title header would
              only repeat it. */}
          <Group error={errors.title}>
            <TextField
              ref={titleRef}
              standalone
              label={TITLE_FIELD}
              placeholder={TUNE_TITLE_LABEL}
              value={values.title}
              maxLength={TUNE_LIMITS.title}
              enterKeyHint="done"
              isInvalid={!!errors.title}
              onChange={(title) => set('title', title)}
            />
          </Group>

          <Group header={STATUS_HEADER} plain>
            <StatusRail
              label={STATUS_HEADER}
              value={values.status}
              onChange={(status) => set('status', status)}
            />
          </Group>

          <Group header={KEY} plain>
            <KeyGrid value={values.key || null} onChange={(key) => set('key', key ?? '')} />
          </Group>

          {form.visibleFields.tunings.length > 0 && (
            <Group header={TUNING_HEADER}>
              {form.visibleFields.tunings.map((instrument) => (
                <Fragment key={instrument}>
                  <SuggestField
                    label={tuningLabel(instrument)}
                    rowLabel={INSTRUMENT_LABELS[instrument]}
                    value={values.tunings[instrument]?.tuning ?? ''}
                    suggestions={TUNINGS[instrument]}
                    maxLength={TUNE_LIMITS.tuning}
                    onChange={(tuning) => form.setTuning(instrument, { tuning })}
                  />
                  {CAPO_INSTRUMENTS[instrument] && (
                    <Picker
                      label={capoLabel(instrument)}
                      value={values.tunings[instrument]?.capo || null}
                      options={asOptions(CAPO_FRETS)}
                      emptyLabel={NO_CAPO}
                      onChange={(capo) => form.setTuning(instrument, { capo: capo ?? '' })}
                    />
                  )}
                </Fragment>
              ))}
            </Group>
          )}

          <Group header={NOTES_SECTION}>
            <TextField
              standalone
              multiline
              label={NOTES_SECTION}
              placeholder={NOTES_PLACEHOLDER}
              value={values.notes}
              maxLength={TUNE_LIMITS.notes}
              onChange={(notes) => set('notes', notes)}
            />
          </Group>

          <Group header={LYRICS_SECTION}>
            <TextField
              standalone
              multiline
              rows={6}
              label={LYRICS_SECTION}
              placeholder={LYRICS_PLACEHOLDER}
              value={values.lyrics}
              maxLength={TUNE_LIMITS.lyrics}
              onChange={(lyrics) => set('lyrics', lyrics)}
            />
          </Group>

          <Group header={DETAILS_HEADER} footer={DETAILS_FOOTER}>
            <DetailRows form={form} />
          </Group>

          <Group header={DETAIL_LABELS.learned_on} error={errors.learned_on} errorId={dateErrorId}>
            <PartialDateField
              ref={dateRef}
              whole
              value={learnedOnParts(values.learned_on)}
              refusedPart={errors.learned_on ? learnedOnRefusedPart(values.learned_on) : null}
              describedBy={dateErrorId}
              onLeave={() => form.validate('learned_on')}
              onChange={(parts) => set('learned_on', learnedOnText(parts))}
            />
          </Group>
        </form>
      )}
    </Sheet>
  )
}

/** The Details card's rows, in the order `DETAIL_FIELDS` reads; learned on has its own card. */
function DetailRows({ form }: { form: TuneForm }) {
  const { values, set, suggestions } = form
  // The fields whose suggestions come from the catalog rather than a fixed list.
  const suggested: Partial<Record<string, readonly string[]>> = {
    tune_type: suggestions.types,
    composer: suggestions.composers,
    learned_from: suggestions.learnedFrom,
  }
  return DETAIL_FIELDS.map((field) => {
    switch (field.kind) {
      case 'text':
        return (
          <TextField
            key={field.key}
            label={field.label}
            value={values[field.key]}
            maxLength={field.maxLength}
            onChange={(value) => set(field.key, value)}
          />
        )
      case 'modes':
        return <ModeRows key={field.key} form={form} />
      case 'switch':
        return (
          <Switch
            key={field.key}
            label={field.label}
            description={field.help}
            isSelected={values[field.key]}
            onChange={(on) => set(field.key, on)}
          />
        )
      case 'date':
        return null
      case 'pick':
        if (field.key === 'time_signature') {
          return (
            <Picker
              key={field.key}
              label={field.label}
              value={values.time_signature || null}
              options={asOptions(TIME_SIGNATURES)}
              emptyLabel={NOT_SET}
              // A pick of the signature already shown sends no change, yet it is still the
              // player's choice, which a type must never replace.
              onChoose={() => form.touch('time_signature')}
              onChange={(value) => set('time_signature', asTimeSignature(value ?? ''))}
            />
          )
        }
        return (
          <SuggestField
            key={field.key}
            label={field.label}
            value={values[field.key]}
            suggestions={suggested[field.key] ?? field.options}
            maxLength={field.maxLength}
            onChange={(value) => set(field.key, value)}
          />
        )
    }
  })
}

/**
 * One mode per part. Rows are only added while the form is open, so clearing one empties it
 * rather than removing it; the save drops empty rows.
 */
function ModeRows({ form }: { form: TuneForm }) {
  const rows = modeRows(form.values.modes)
  return (
    <>
      {rows.map((mode, index) => (
        <Picker
          key={PART_MODE_LABELS[index]}
          label={PART_MODE_LABELS[index]!}
          value={mode || null}
          options={asOptions(MODES)}
          emptyLabel={NOT_SET}
          onChange={(value) => form.setPartMode(index, value ?? '')}
        />
      ))}
      {canAddPartMode(form.values.modes) && (
        <AriaButton
          onPress={form.addPartMode}
          className={`${FIELD_ROW_PRESSABLE} text-action font-medium`}
        >
          <Plus className="size-5 shrink-0" aria-hidden />
          {ADD_PART_MODE}
        </AriaButton>
      )}
    </>
  )
}
