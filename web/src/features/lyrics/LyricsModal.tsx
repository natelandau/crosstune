import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonModal,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import { AArrowDown, AArrowUp, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { updateTune } from '../../commands/tunes'
import { useDb } from '../../db/DbProvider'
import { useWakeLock } from '../../platform/wakeLock'
import { useDialogName } from '../../ui/dialogName'
import { useAction } from '../../ui/useAction'
import { lyricLines } from './lyricLines'
import { LyricsSheet } from './LyricsSheet'
import { LYRICS_STEPS, stepLyricsSize, useLyricsStep } from './lyricsSize'

export const EDIT_LYRICS = 'Edit lyrics'
export const LARGER_TEXT = 'Larger text'
export const SMALLER_TEXT = 'Smaller text'

/**
 * Keep a toolbar control's disabled state where a screen reader reads it. Ionic copies aria-*
 * from an ion-button onto the native button inside its shadow root once, while the component
 * loads, and takes them off the host; only aria-label, aria-checked and aria-pressed are watched
 * after that, so a state that changes with the text size has to be written in place.
 */
function useAriaDisabled(button: RefObject<HTMLIonButtonElement | null>, disabled: boolean): void {
  useEffect(() => {
    const element = button.current
    if (!element) return
    let live = true
    // The element carries componentOnReady once Ionic has defined it, and its shadow root holds
    // nothing before then.
    void Promise.resolve(element.componentOnReady?.()).then(() => {
      if (!live) return
      element.shadowRoot?.querySelector('button')?.setAttribute('aria-disabled', String(disabled))
    })
    return () => {
      live = false
    }
  }, [button, disabled])
}

/**
 * The words at reading distance. It covers the tab bar and the dock, because a fifth of a phone
 * screen is three or four lines of large text, and it carries no control but the size and the
 * way out. A line break in a tune is meaning, so each line is its own block with a hanging
 * indent: a wrap sits under its line and a new line starts at the margin.
 */
export function LyricsModal({
  open,
  tuneId,
  title,
  lyrics,
  onClose,
}: {
  open: boolean
  tuneId: string
  title: string
  lyrics: string
  onClose: () => void
}) {
  const db = useDb()
  const [editing, setEditing] = useState(false)
  const { error, pending, runThen, clear } = useAction()
  const step = useLyricsStep()
  const [announced, setAnnounced] = useState('')
  // A body runs to 20,000 characters, and every keystroke elsewhere on the screen re-renders
  // this one, so it is parsed once per body. The words stay through the closing animation,
  // which Ionic runs while the contents are still mounted.
  const verses = useMemo(() => lyricLines(lyrics), [lyrics])
  const atSmallest = step <= 1
  const atLargest = step >= LYRICS_STEPS
  const smaller = useRef<HTMLIonButtonElement>(null)
  const larger = useRef<HTMLIonButtonElement>(null)
  const modal = useRef<HTMLIonModalElement>(null)
  useAriaDisabled(smaller, atSmallest)
  useAriaDisabled(larger, atLargest)
  useDialogName(modal, `${title} lyrics`)
  useWakeLock(open)

  // Cleared during render, so the first frame of an opening is already silent: the live region
  // holds its last text for as long as it is mounted, and a reader exploring the view would
  // find the step announced the time before and read it as if it had just been said.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setAnnounced('')
      // The editor belongs to the reading it was opened from: a screen that closes while it is
      // up would otherwise open straight into it the next time a musician asks to read.
      setEditing(false)
      clear()
    }
  }

  const move = (by: number) => {
    if (by < 0 ? atSmallest : atLargest) return
    const next = stepLyricsSize(by)
    setAnnounced(`Text size ${next} of ${LYRICS_STEPS}`)
  }

  return (
    // The name says which tune, as the toolbar does, so a reader entering the dialog knows it
    // opened the right one. The prop is only the first name: a tune renamed on the screen
    // behind this one reaches the dialog through useDialogName.
    <IonModal ref={modal} isOpen={open} aria-label={`${title} lyrics`} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar className="lyrics-toolbar">
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <IonButton
              ref={smaller}
              className={atSmallest ? 'toolbar-control control-at-limit' : 'toolbar-control'}
              aria-label={SMALLER_TEXT}
              // aria-disabled rather than disabled: a disabled element cannot hold focus, so a
              // keyboard reaching the end of the scale would be dropped to the document.
              aria-disabled={atSmallest}
              onClick={() => move(-1)}
            >
              <AArrowDown aria-hidden="true" className="size-6" />
            </IonButton>
            <IonButton
              ref={larger}
              className={atLargest ? 'toolbar-control control-at-limit' : 'toolbar-control'}
              aria-label={LARGER_TEXT}
              aria-disabled={atLargest}
              onClick={() => move(1)}
            >
              <AArrowUp aria-hidden="true" className="size-6" />
            </IonButton>
            <IonButton className="toolbar-control" aria-label="Close" onClick={onClose}>
              <X aria-hidden="true" className="size-6" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div
          data-lyrics-size={step}
          // The tail lets the last verse scroll to the middle of the screen, which is where a
          // propped phone is read, rather than sitting against the bottom edge.
          className="type-lyrics mx-auto max-w-[38ch] px-(--form-gutter) pt-4 pb-[45vh]"
        >
          {verses.map((lines, verse) => (
            <div key={verse} data-verse className="[&+&]:mt-[0.9em]">
              {lines.map((line, index) => (
                <p key={index} className="m-0 pl-[1.25ch] -indent-[1.25ch]">
                  {line}
                </p>
              ))}
            </div>
          ))}
          {/* After the words, not in the toolbar: a musician who has read to the end is already
              here, and a scroll mid-tune never reaches it. */}
          <div className="pt-(--form-section-gap)">
            <IonButton fill="clear" expand="block" onClick={() => setEditing(true)}>
              {EDIT_LYRICS}
            </IonButton>
          </div>
        </div>
        <p role="status" className="sr-only">
          {announced}
        </p>
      </IonContent>
      {/* No tune form stands behind this one, so Done is the write, the way every other
          single-field sheet in the client behaves: the sheet holds the words until the write
          lands, so a refusal leaves them there to try again rather than dropping them. */}
      <LyricsSheet
        open={editing}
        value={lyrics}
        error={error}
        pending={pending}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
          const body = next.trim()
          runThen(
            () => updateTune(db, tuneId, { lyrics: body || null }),
            () => setEditing(false),
          )
        }}
      />
    </IonModal>
  )
}
