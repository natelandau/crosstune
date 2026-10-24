import { useEffect, useId, useRef, useState } from 'react'
import { TIME_SIGNATURES, TUNE_LIMITS } from '../../api/vocabulary'
import { DETAIL_FIELDS, DETAIL_LABELS, DETAILS_FOOTER } from './detailFields'
import { ModeRows, TuningRows } from './tuneFieldRows'
import {
  DETAILS_HEADER,
  EDIT_TUNE_TITLE,
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
  learnedOnParts,
  learnedOnRefusedPart,
  learnedOnText,
} from './tuneFormValues'
import { LYRICS_SECTION, NOTES_SECTION } from './tuneScreenCopy'
import { useTuneForm, type TuneForm } from './useTuneForm'
import { NOT_SET } from '../../ui/fieldCopy'
import { KEY } from '../../ui/keyName'
import { useLatest } from '../../ui/useLatest'
import { ErrorLine } from '../../ui/ErrorLine'
import { Group } from '../../ui/form/Group'
import { PartialDateField } from '../../ui/form/PartialDateField'
import { Picker } from '../../ui/form/Picker'
import { asOptions } from '../../ui/form/pickerOptions'
import { StatusRail } from '../../ui/form/StatusRail'
import { SuggestField } from '../../ui/form/SuggestField'
import { Switch } from '../../ui/form/Switch'
import { TextField } from '../../ui/form/TextField'
import { KeyGrid } from '../../ui/KeyGrid'
import { Sheet } from '../../ui/Sheet'
import { useResetOnChange } from '../../ui/useResetOnChange'
import type { TuneFormOptions } from './formLauncher'

type FieldRef = HTMLInputElement & HTMLTextAreaElement

export interface TuneFormSheetProps extends TuneFormOptions {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * An edit of a tune as a full-height sheet on touch and a dialog on pointer.
 * Fields are ranked by use: title, status, key, tunings, notes, and lyrics, then the rarer
 * details.
 */
export function TuneFormSheet(props: TuneFormSheetProps) {
  // Each open is a fresh form, so nothing typed in one open reaches the next.
  const [opens, setOpens] = useState(props.isOpen ? 1 : 0)
  useResetOnChange(props.isOpen, () => {
    if (props.isOpen) setOpens((count) => count + 1)
  })
  return <TuneFormBody key={opens} {...props} />
}

function TuneFormBody({ isOpen, onOpenChange, tuneId, focus }: TuneFormSheetProps) {
  const titleRef = useRef<FieldRef>(null)
  const dateRef = useRef<HTMLDivElement>(null)
  const dateErrorId = useId()
  // Counts refused saves, so focus moves to the refused field on a save and never as one types.
  const [refusals, setRefusals] = useState(0)
  const closeRef = useLatest(() => onOpenChange(false))
  const isOpenRef = useLatest(isOpen)

  const form = useTuneForm({
    tuneId,
    enabled: isOpen,
    onSaved: () => {
      // Closed while the save ran, the sheet has already gone.
      if (isOpenRef.current) closeRef.current()
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

  const typed = Object.values(form.touched).some(Boolean)
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={EDIT_TUNE_TITLE}
      height="full"
      locked={typed || form.pending}
      primary={{
        label: SAVE_TUNE,
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
                <TuningRows
                  key={instrument}
                  instrument={instrument}
                  entry={values.tunings[instrument]}
                  onChange={(patch) => form.setTuning(instrument, patch)}
                />
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
              autoFocus={focus === 'lyrics'}
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
        return <FormModeRows key={field.key} form={form} />
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
function FormModeRows({ form }: { form: TuneForm }) {
  return <ModeRows modes={form.values.modes} onChange={form.setPartMode} onAdd={form.addPartMode} />
}
