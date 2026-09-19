import {
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonTextarea,
  IonToggle,
} from '@ionic/react'
import { useRef, useState } from 'react'
import { createSong, updateSongEntry } from '../../commands/songs'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { STATUSES, type Instrument, type SongStatus } from '../../db/types'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { Sheet } from '../../ui/Sheet'
import type { CatalogEntry } from '../catalog/filters'
import { STATUS_LABELS } from '../catalog/status'
import { TUNING_FIELDS, visibleTunings, type TuningField } from '../settings/instruments'
import { FieldRow } from '../../ui/FieldRow'
import { KeyChooser } from './KeyChooser'
import { DETAIL_FIELDS, DETAILS_FOOTER } from './detailFields'
import { SONG_LIMITS } from './limits'
import {
  asMode,
  asTimeSignature,
  emptyValues,
  inputsFromValues,
  valuesFromRows,
  type SongFormValues,
} from './songFormValues'
import { SuggestSelect } from './SuggestSelect'
import { TUNING_SUGGESTIONS } from './suggestions'

export type SongFormTarget = { kind: 'new'; title?: string } | { kind: 'edit'; entry: CatalogEntry }

function initialValues(target: SongFormTarget): SongFormValues {
  if (target.kind === 'edit') return valuesFromRows(target.entry.song, target.entry.userSong)
  // A seeded title arrives from a search box with no limit of its own, and the field's
  // maxlength only holds back typing, so the cap has to be applied to the value itself.
  return { ...emptyValues(), title: (target.title ?? '').slice(0, SONG_LIMITS.title) }
}

export function SongFormSheet({
  target,
  instruments,
  onClose,
  onSaved,
}: {
  /**
   * The song to edit or the new song to start, or null for a closed sheet. The sheet never
   * clears it: the parent sets it back to null from onClose.
   */
  target: SongFormTarget | null
  instruments: ReadonlySet<Instrument>
  onClose: () => void
  onSaved: (ids: { songId: string; userSongId: string }) => void
}) {
  const db = useDb()
  const { error, pending, runThen, clear } = useAction()
  const [values, setValues] = useState<SongFormValues>(emptyValues)
  const [tunings, setTunings] = useState<TuningField[]>([])
  const [validation, setValidation] = useState<string | null>(null)
  const titleRef = useRef<HTMLIonInputElement>(null)
  // The target a save is running for. A ref, because two submits in one tick both read the
  // same `pending` state.
  const savingFor = useRef<SongFormTarget | null>(null)
  const [openedFor, setOpenedFor] = useState<SongFormTarget | null>(null)
  // The last target shown, so the title and action label hold while the sheet animates closed.
  const [shown, setShown] = useState<SongFormTarget | null>(null)
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
      setTunings(visibleTunings(instruments, target.kind === 'edit' ? target.entry.song : null))
      setValidation(null)
      clear()
    }
  }

  const set = <K extends keyof SongFormValues>(key: K, value: SongFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const save = () => {
    // Enter reaches this through the hidden submit button, which the toolbar's disabled state
    // does not cover.
    if (!target || closing || savingFor.current === target) return
    const { song, userSong } = inputsFromValues(values)
    if (!song.title) {
      // A rejection from an earlier attempt no longer describes this form.
      clear()
      setValidation('A title is required')
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
      let ids = { songId: '', userSongId: '' }
      runThen(
        async () => {
          ids = await createSong(db, song, userSong).catch(failed)
        },
        () => {
          setClosing(true)
          onSaved(ids)
        },
      )
      return
    }
    const { song: current, userSong: currentUser } = target.entry
    runThen(
      async () => {
        await updateSongEntry(
          db,
          { songId: current.id, userSongId: currentUser.id },
          song,
          userSong,
        ).catch(failed)
      },
      () => {
        setClosing(true)
        onSaved({ songId: current.id, userSongId: currentUser.id })
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
      title={editing ? 'Edit song' : 'New song'}
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
        {error ? <InlineError className="px-8 pt-3">{error}</InlineError> : null}
        {/* A form with several fields submits on Enter only when it has a submit button. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />

        {/* The sheet's own title already says New song or Edit song, so a Title header would
            only repeat it. The placeholder names the field where the musician is looking. */}
        <Group error={validation}>
          <IonItem>
            <IonInput
              ref={titleRef}
              data-field="title"
              aria-label="Title"
              placeholder="Song title"
              aria-invalid={validation ? 'true' : undefined}
              maxlength={SONG_LIMITS.title}
              value={values.title}
              enterkeyhint="done"
              onIonInput={(event) => {
                set('title', String(event.detail.value ?? ''))
                if (validation) setValidation(null)
              }}
            />
          </IonItem>
        </Group>

        {/* Known, Learning, and Unknown say what the control is, so it carries no header. */}
        <Group plain>
          <IonSegment
            aria-label="Status"
            className="mx-4"
            value={values.status}
            onIonChange={(event) => set('status', event.detail.value as SongStatus)}
          >
            {STATUSES.map((status) => (
              <IonSegmentButton key={status} value={status}>
                <IonLabel>{STATUS_LABELS[status]}</IonLabel>
              </IonSegmentButton>
            ))}
          </IonSegment>
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
                maxLength={SONG_LIMITS[field]}
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
              maxlength={SONG_LIMITS.notes}
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
                    <span data-row-label>{field.label}</span>
                    {field.help ? <span className="type-footnote block">{field.help}</span> : null}
                  </IonToggle>
                </IonItem>
              )
            }
            if (field.kind === 'date') {
              return (
                <FieldRow key={field.key} label={field.label} detail={field.label}>
                  <IonInput
                    type="date"
                    aria-label={field.label}
                    className="ms-auto text-end"
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
                    placeholder={field.placeholder ?? 'Not set'}
                    className="ms-auto text-end"
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
                  if (field.key === 'mode') set('mode', asMode(value))
                  else if (field.key === 'time_signature')
                    set('time_signature', asTimeSignature(value))
                  else set(field.key, value)
                }}
              />
            )
          })}
        </Group>
      </form>
    </Sheet>
  )
}
