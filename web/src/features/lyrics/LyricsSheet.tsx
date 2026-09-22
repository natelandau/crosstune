import { IonButton, IonItem, IonTextarea } from '@ionic/react'
import { useState } from 'react'
import { SONG_LIMITS } from '../../api/vocabulary'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'

/**
 * The whole lyrics body, at the height a body needs. Done hands the text to whoever opened the
 * sheet rather than writing it: from the song form that keeps it until the form is saved, so
 * the form stays one transaction and cancelling it discards the words with everything else, and
 * from the reading view that writes it on its own. A caller that writes passes `pending` and
 * `error`, and holds the sheet open until the write lands, so refused words stay in the box.
 */
export function LyricsSheet({
  open,
  value,
  error = null,
  pending = false,
  onCancel,
  onSave,
}: {
  open: boolean
  value: string
  /** A refused write, shown under the box. */
  error?: string | null
  /** True while a caller's write is in flight, to hold the sheet's controls still. */
  pending?: boolean
  onCancel: () => void
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [opened, setOpened] = useState(false)

  // Reset during render, so the sheet's first frame already holds the form's current words.
  if (open && !opened) {
    setOpened(true)
    setDraft(value)
  }
  if (!open && opened) setOpened(false)

  return (
    <Sheet
      open={open}
      title="Lyrics"
      height="full"
      dismissible={false}
      onClose={onCancel}
      start={
        <IonButton disabled={pending} onClick={onCancel}>
          Cancel
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending} onClick={() => onSave(draft)}>
          Done
        </IonButton>
      }
    >
      {/* The sheet's title already names the field, so a header would only repeat it. */}
      <Group error={error}>
        <IonItem>
          <IonTextarea
            aria-label="Lyrics"
            placeholder="The words, a verse at a time…"
            autoGrow
            rows={16}
            maxlength={SONG_LIMITS.lyrics}
            value={draft}
            onIonInput={(event) => setDraft(String(event.detail.value ?? ''))}
          />
        </IonItem>
      </Group>
    </Sheet>
  )
}
