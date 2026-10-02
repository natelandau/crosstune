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
import { CANCEL } from '../../ui/Confirm'
import { useSheetSession } from '../../ui/useSheetSession'

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
  const [validation, setValidation] = useState<string | null>(null)
  const urlRef = useRef<HTMLIonInputElement>(null)
  const sheet = useSheetSession(tuneId, {
    onOpen: () => {
      setUrl('')
      setValidation(null)
      clear()
    },
    onClose,
  })

  const submit = () => {
    if (!tuneId || !sheet.canSave()) return
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
    sheet.beginSave()
    const target = tuneId
    runThen(async () => {
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
        })
      } catch (caught) {
        sheet.saveFailed(caught)
      }
    }, sheet.close)
  }

  return (
    <Sheet
      open={sheet.open}
      title={PASTE_LINK}
      dismissible={false}
      onClose={sheet.dismissed}
      start={
        <IonButton disabled={pending} onClick={sheet.close}>
          {CANCEL}
        </IonButton>
      }
      end={
        <IonButton strong disabled={pending || sheet.closing} onClick={submit}>
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
              enterkeyhint="done"
              onIonInput={(event) => {
                setUrl(String(event.detail.value ?? ''))
                setValidation(null)
                clear()
              }}
            />
          </IonItem>
        </Group>
      </form>
    </Sheet>
  )
}
