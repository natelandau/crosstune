import { IonButton, IonInput, IonItem } from '@ionic/react'
import { useRef, useState } from 'react'
import type { ResolveResponse } from '../../api/types'
import { addLink } from '../../commands/links'
import { LINK_LIMITS } from '../../constants'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { detectProvider, isProvider } from './detect'

/** Pastes a link to a recording elsewhere onto a song, over whatever screen asked. */
export function PasteLinkSheet({
  songId,
  onClose,
}: {
  /** Null means closed; the parent nulls it from onClose. */
  songId: string | null
  onClose: () => void
}) {
  const db = useDb()
  const engine = useSyncEngine()
  const { error, pending, runThen, clear } = useAction()
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  // The song a submit is running for. A ref, because two submits in one tick both read the
  // same `pending` state.
  const saving = useRef<string | null>(null)
  const urlRef = useRef<HTMLIonInputElement>(null)

  // Reset during render so the sheet's first frame already shows empty fields.
  if (songId !== openedFor) {
    setOpenedFor(songId)
    if (songId) {
      setUrl('')
      setLabel('')
      setValidation(null)
      setClosing(false)
      clear()
    }
  }

  // A dismissal that ends after the sheet reopened for another song belongs to the old one.
  const dismissed = () => {
    saving.current = null
    if (songId === null || closing) onClose()
  }

  const submit = () => {
    if (!songId || closing || saving.current === songId) return
    const trimmed = url.trim()
    if (!trimmed) {
      clear()
      setValidation('Paste a link to add it')
      void urlRef.current?.setFocus()
      return
    }
    setValidation(null)
    saving.current = songId
    const target = songId
    const trimmedLabel = label.trim()
    runThen(
      async () => {
        // Metadata is a nicety; a link the resolver cannot reach still gets added.
        const resolved: ResolveResponse | null = await engine.resolveLink(trimmed)
        const detected = detectProvider(trimmed)
        // A provider the resolver returned that this client doesn't recognize can't carry
        // that provider's ref either, since the ref format is provider-specific.
        const { provider, provider_ref } =
          resolved && isProvider(resolved.provider)
            ? { provider: resolved.provider, provider_ref: resolved.provider_ref }
            : detected
        try {
          await addLink(db, target, {
            url: resolved?.url ?? trimmed,
            provider,
            provider_ref,
            title: resolved?.title ?? null,
            artwork_url: resolved?.artwork_url ?? null,
            label: trimmedLabel || null,
          })
        } catch (caught) {
          saving.current = null
          throw caught
        }
      },
      () => setClosing(true),
    )
  }

  return (
    <Sheet
      open={songId !== null && !closing}
      title="Paste link"
      dismissible={false}
      onClose={dismissed}
      start={
        <IonButton disabled={pending} onClick={() => setClosing(true)}>
          Cancel
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || closing} onClick={submit}>
          Add link
        </IonButton>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {/* A form with several fields submits on Enter only when it has a submit button. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />
        <Group header="Link" error={validation ?? error}>
          <IonItem>
            <IonInput
              ref={urlRef}
              aria-label="Link"
              type="url"
              inputmode="url"
              placeholder="Paste a YouTube, Spotify, or other link"
              maxlength={LINK_LIMITS.url}
              value={url}
              enterkeyhint="next"
              onIonInput={(event) => {
                setUrl(String(event.detail.value ?? ''))
                setValidation(null)
                clear()
              }}
            />
          </IonItem>
        </Group>
        <Group header="Label">
          <IonItem>
            <IonInput
              aria-label="Label"
              placeholder="slow version, jam recording, …"
              maxlength={LINK_LIMITS.label}
              value={label}
              enterkeyhint="done"
              onIonInput={(event) => setLabel(String(event.detail.value ?? ''))}
            />
          </IonItem>
        </Group>
      </form>
    </Sheet>
  )
}
