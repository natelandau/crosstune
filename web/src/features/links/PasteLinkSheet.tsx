import { IonButton, IonInput, IonItem } from '@ionic/react'
import { useRef, useState } from 'react'
import type { ResolveResponse } from '../../api/types'
import { LINK_LIMITS } from '../../api/vocabulary'
import { addLink } from '../../commands/links'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { detectProvider, isProvider } from './detect'
import { outboundUrl } from './display'

export const PASTE_LINK = 'Paste link'
export const ADD_LINK = 'Add link'
export const LINK_PLACEHOLDER = 'Paste a YouTube, Spotify, or other link'
export const LINK_REQUIRED = 'Paste a link to add it'
export const LINK_NOT_WEB = 'Paste a web address, one that starts with http or https'

/** Pastes a link to a recording elsewhere onto a tune, over whatever screen asked. */
export function PasteLinkSheet({
  tuneId,
  onClose,
}: {
  /** Null means closed; the parent nulls it from onClose. */
  tuneId: string | null
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
  // The tune a submit is running for. A ref, because two submits in one tick both read the
  // same `pending` state.
  const saving = useRef<string | null>(null)
  const urlRef = useRef<HTMLIonInputElement>(null)

  // Reset during render so the sheet's first frame already shows empty fields.
  if (tuneId !== openedFor) {
    setOpenedFor(tuneId)
    if (tuneId) {
      setUrl('')
      setLabel('')
      setValidation(null)
      setClosing(false)
      clear()
    }
  }

  // A dismissal that ends after the sheet reopened for another tune belongs to the old one.
  const dismissed = () => {
    saving.current = null
    if (tuneId === null || closing) onClose()
  }

  const submit = () => {
    if (!tuneId || closing || saving.current === tuneId) return
    const trimmed = url.trim()
    if (!trimmed) {
      clear()
      setValidation(LINK_REQUIRED)
      void urlRef.current?.setFocus()
      return
    }
    if (outboundUrl({ url: trimmed }) === null) {
      clear()
      setValidation(LINK_NOT_WEB)
      void urlRef.current?.setFocus()
      return
    }
    setValidation(null)
    saving.current = tuneId
    const target = tuneId
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
      open={tuneId !== null && !closing}
      title={PASTE_LINK}
      dismissible={false}
      onClose={dismissed}
      start={
        <IonButton disabled={pending} onClick={() => setClosing(true)}>
          Cancel
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || closing} onClick={submit}>
          {ADD_LINK}
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
              placeholder={LINK_PLACEHOLDER}
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
