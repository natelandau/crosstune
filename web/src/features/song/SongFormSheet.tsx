import { IonButton, IonInput, IonItem, IonTextarea, IonToggle } from '@ionic/react'
import { useEffect, useRef, useState } from 'react'
import { SONG_LIMITS, type Instrument } from '../../api/vocabulary'
import { createSong, updateSongEntry } from '../../commands/songs'
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
  type SongFormValues,
} from './songFormValues'
import { StatusChooser } from './StatusChooser'
import { SuggestSelect } from './SuggestSelect'

export const TITLE_REQUIRED = 'A title is required'
export const EDIT_SONG_TITLE = 'Edit song'
export const NEW_SONG_TITLE = 'New song'
export const SONG_TITLE_LABEL = 'Song title'

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
  const [editingLyrics, setEditingLyrics] = useState(false)
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
      title={editing ? EDIT_SONG_TITLE : NEW_SONG_TITLE}
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

        {/* The sheet's own title already says New song or Edit song, so a Title header would
            only repeat it. The placeholder names the field where the musician is looking. */}
        <Group error={validation}>
          <IonItem>
            <IonInput
              ref={titleRef}
              data-field="title"
              aria-label="Title"
              placeholder={SONG_TITLE_LABEL}
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
              // because no count of a song's words is one a musician would trust.
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
                  if (field.key === 'mode') set('mode', asMode(value))
                  else if (field.key === 'time_signature') {
                    // A player's own pick or clear always wins over the row's raw value.
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
