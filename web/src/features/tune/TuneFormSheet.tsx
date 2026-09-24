import { IonButton, IonInput, IonItem, IonTextarea, IonToggle } from '@ionic/react'
import { useEffect, useRef, useState } from 'react'
import { TUNE_LIMITS, type Instrument } from '../../api/vocabulary'
import { createTune, updateTuneEntry } from '../../commands/tunes'
import { TUNING_SUGGESTIONS } from '../../constants'
import { useDb } from '../../db/DbProvider'
import { FieldRow, NOT_SET } from '../../ui/FieldRow'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import type { CatalogEntry } from '../catalog/filters'
import { LyricsSheet } from '../lyrics/LyricsSheet'
import { TUNING_FIELDS, visibleTunings, type TuningField } from '../settings/instruments'
import { DETAIL_FIELDS, DETAILS_FOOTER } from './detailFields'
import { KeyChooser } from './KeyChooser'
import {
  asMode,
  asTimeSignature,
  emptyValues,
  inputsFromValues,
  valuesFromRows,
  type TuneFormValues,
} from './tuneFormValues'
import { StatusChooser } from './StatusChooser'
import { SuggestSelect } from './SuggestSelect'

export const TITLE_REQUIRED = 'A title is required'
export const EDIT_TUNE_TITLE = 'Edit tune'
export const NEW_TUNE_TITLE = 'New tune'
export const TUNE_TITLE_LABEL = 'Tune title'

export type TuneFormTarget = { kind: 'new'; title?: string } | { kind: 'edit'; entry: CatalogEntry }

function initialValues(target: TuneFormTarget): TuneFormValues {
  if (target.kind === 'edit') return valuesFromRows(target.entry.tune, target.entry.userTune)
  // A seeded title arrives from a search box with no limit of its own, and the field's
  // maxlength only holds back typing, so the cap has to be applied to the value itself.
  return { ...emptyValues(), title: (target.title ?? '').slice(0, TUNE_LIMITS.title) }
}

export function TuneFormSheet({
  target,
  instruments,
  onClose,
  onSaved,
}: {
  /**
   * The tune to edit or the new tune to start, or null for a closed sheet. The sheet never
   * clears it: the parent sets it back to null from onClose.
   */
  target: TuneFormTarget | null
  instruments: ReadonlySet<Instrument>
  onClose: () => void
  onSaved: (ids: { tuneId: string; userTuneId: string }) => void
}) {
  const db = useDb()
  const { error, pending, runThen, clear } = useAction()
  const [values, setValues] = useState<TuneFormValues>(emptyValues)
  const [tunings, setTunings] = useState<TuningField[]>([])
  const [validation, setValidation] = useState<string | null>(null)
  const titleRef = useRef<HTMLIonInputElement>(null)
  // The target a save is running for. A ref, because two submits in one tick both read the
  // same `pending` state.
  const savingFor = useRef<TuneFormTarget | null>(null)
  const [openedFor, setOpenedFor] = useState<TuneFormTarget | null>(null)
  const [editingLyrics, setEditingLyrics] = useState(false)
  // The last target shown, so the title and action label hold while the sheet animates closed.
  const [shown, setShown] = useState<TuneFormTarget | null>(null)
  // Set by Cancel or a save; the sheet closes itself and reports it once, when dismissal ends.
  const [closing, setClosing] = useState(false)

  // Reset during render so the sheet's first frame already shows the target's values. Tunings
  // are decided at open, so a field never disappears mid-edit.
  if (target !== openedFor) {
    setOpenedFor(target)
    if (target) {
      setShown(target)
      setClosing(false)
      setValues(initialValues(target))
      setTunings(visibleTunings(instruments, target.kind === 'edit' ? target.entry.tune : null))
      setValidation(null)
      setEditingLyrics(false)
      clear()
    }
  }

  // Ionic copies aria-* onto the native input once, while the component loads, and takes them
  // off the host; an attribute set on the host later reaches nothing. The title is only ever
  // invalid after that point, so the state is written where a screen reader will read it.
  useEffect(() => {
    const input = titleRef.current?.querySelector('input')
    if (!input) return
    if (validation) input.setAttribute('aria-invalid', 'true')
    else input.removeAttribute('aria-invalid')
  }, [validation])

  const set = <K extends keyof TuneFormValues>(key: K, value: TuneFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const save = () => {
    // Enter reaches this through the hidden submit button, which the toolbar's disabled state
    // does not cover.
    if (!target || closing || savingFor.current === target) return
    const { tune, userTune } = inputsFromValues(values)
    if (!tune.title) {
      // A rejection from an earlier attempt no longer describes this form.
      clear()
      setValidation(TITLE_REQUIRED)
      void titleRef.current?.setFocus()
      return
    }
    savingFor.current = target
    const failed = (error: unknown): never => {
      savingFor.current = null
      throw error
    }
    setValidation(null)
    if (target.kind === 'new') {
      let ids = { tuneId: '', userTuneId: '' }
      runThen(
        async () => {
          ids = await createTune(db, tune, userTune).catch(failed)
        },
        () => {
          setClosing(true)
          onSaved(ids)
        },
      )
      return
    }
    const { tune: current, userTune: currentUser } = target.entry
    runThen(
      async () => {
        await updateTuneEntry(
          db,
          { tuneId: current.id, userTuneId: currentUser.id },
          tune,
          userTune,
        ).catch(failed)
      },
      () => {
        setClosing(true)
        onSaved({ tuneId: current.id, userTuneId: currentUser.id })
      },
    )
  }

  // A dismissal that ends after a new target opened belongs to the old one, so it closes nothing.
  const dismissed = () => {
    // A parent may reopen the sheet with the very target object that was just saved.
    savingFor.current = null
    if (target === null || closing) onClose()
  }

  const editing = shown?.kind === 'edit'
  return (
    <Sheet
      open={target !== null && !closing}
      title={editing ? EDIT_TUNE_TITLE : NEW_TUNE_TITLE}
      height="full"
      dismissible={false}
      onClose={dismissed}
      start={
        <IonButton disabled={pending} onClick={() => setClosing(true)}>
          Cancel
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || closing} onClick={save}>
          {editing ? 'Save' : 'Add'}
        </IonButton>
      }
    >
      <form
        className="pb-8"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        noValidate
      >
        {error ? <InlineError className="px-(--form-inset) pt-3">{error}</InlineError> : null}
        {/* A form with several fields submits on Enter only when it has a submit button. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />

        {/* The sheet's own title already says New tune or Edit tune, so a Title header would
            only repeat it. The placeholder names the field where the musician is looking. */}
        <Group error={validation}>
          <IonItem>
            <IonInput
              ref={titleRef}
              data-field="title"
              aria-label="Title"
              placeholder={TUNE_TITLE_LABEL}
              maxlength={TUNE_LIMITS.title}
              value={values.title}
              enterkeyhint="done"
              onIonInput={(event) => {
                set('title', String(event.detail.value ?? ''))
                if (validation) setValidation(null)
              }}
            />
          </IonItem>
        </Group>

        <Group header="Status" plain>
          <StatusChooser value={values.status} onChange={(status) => set('status', status)} />
        </Group>

        <Group header="Key" plain>
          <KeyChooser value={values.key} onChange={(value) => set('key', value)} />
        </Group>

        {tunings.length > 0 ? (
          <Group header="Tuning">
            {tunings.map((field) => (
              <SuggestSelect
                key={field}
                label={TUNING_FIELDS[field].label}
                rowLabel={TUNING_FIELDS[field].short}
                value={values[field]}
                options={TUNING_SUGGESTIONS[field]}
                other
                maxLength={TUNE_LIMITS[field]}
                onChange={(value) => set(field, value)}
              />
            ))}
          </Group>
        ) : null}

        <Group header="Notes">
          <IonItem>
            <IonTextarea
              aria-label="Notes"
              placeholder="How it goes, where it came from…"
              autoGrow
              rows={3}
              maxlength={TUNE_LIMITS.notes}
              value={values.notes}
              onIonInput={(event) => set('notes', String(event.detail.value ?? ''))}
            />
          </IonItem>
        </Group>

        <Group header="Details" footer={DETAILS_FOOTER}>
          {DETAIL_FIELDS.map((field) => {
            if (field.kind === 'switch') {
              return (
                <IonItem key={field.key} data-detail={field.label}>
                  <IonToggle
                    checked={values[field.key]}
                    onIonChange={(event) => set(field.key, event.detail.checked)}
                  >
                    <span data-row-label className="type-body">
                      {field.label}
                    </span>
                    {field.help ? <span className="type-footnote block">{field.help}</span> : null}
                  </IonToggle>
                </IonItem>
              )
            }
            if (field.kind === 'lyrics') {
              // Not a field of this form: the words have a form of their own, and this is the
              // way to it. The chevron says so, and nothing about the body is counted here,
              // because no count of a tune's words is one a musician would trust.
              return (
                <IonItem
                  key={field.key}
                  button
                  detail
                  data-detail={field.label}
                  onClick={() => setEditingLyrics(true)}
                >
                  <span data-row-label className="type-body">
                    {field.label}
                  </span>
                </IonItem>
              )
            }
            if (field.kind === 'date') {
              return (
                <FieldRow key={field.key} label={field.label} detail={field.label}>
                  <IonInput
                    type="date"
                    aria-label={field.label}
                    value={values[field.key]}
                    onIonInput={(event) => set(field.key, String(event.detail.value ?? ''))}
                  />
                </FieldRow>
              )
            }
            if (field.kind === 'text') {
              return (
                <FieldRow key={field.key} label={field.label} detail={field.label}>
                  <IonInput
                    aria-label={field.label}
                    placeholder={NOT_SET}
                    maxlength={field.maxLength}
                    value={values[field.key]}
                    onIonInput={(event) => set(field.key, String(event.detail.value ?? ''))}
                  />
                </FieldRow>
              )
            }
            return (
              <SuggestSelect
                key={field.key}
                detail={field.label}
                label={field.label}
                value={values[field.key]}
                options={field.options}
                other={field.other}
                maxLength={field.maxLength}
                onChange={(value) => {
                  // A player's own pick or clear always wins over the row's raw value.
                  if (field.key === 'mode') {
                    set('mode', asMode(value))
                    set('mode_raw', null)
                  } else if (field.key === 'time_signature') {
                    set('time_signature', asTimeSignature(value))
                    set('time_signature_raw', null)
                  } else set(field.key, value)
                }}
              />
            )
          })}
        </Group>

        <LyricsSheet
          open={editingLyrics}
          value={values.lyrics}
          onCancel={() => setEditingLyrics(false)}
          onSave={(next) => {
            set('lyrics', next)
            setEditingLyrics(false)
          }}
        />
      </form>
    </Sheet>
  )
}
