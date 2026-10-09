import { useState } from 'react'
import type { ResolveResponse } from '../../api/types'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { serviceOf } from '../../analytics/service'
import { addLink } from '../../commands/links'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { useAction } from '../../ui/useAction'
import { useSheetSession } from '../../ui/useSheetSession'
import { detectProvider, isProvider } from './detect'
import { outboundUrl } from './display'
import { LINK_NOT_WEB, LINK_REQUIRED } from './pasteLinkCopy'

export interface PasteLink {
  /** Whether the sheet shows: it has a tune and nothing has asked it to close. */
  open: boolean
  /** Cancel or an add asked the sheet to close; it reports that once dismissal ends. */
  closing: boolean
  url: string
  /** Sets the typed link and drops the last refusal. */
  setUrl: (url: string) => void
  /** Why the typed link was refused before anything was saved. */
  validation: string | null
  /** The last add's refusal. */
  error: string | null
  pending: boolean
  /** Adds the typed link to the tune, then closes. */
  submit: () => void
  close: () => void
  /** The sheet's onClose, run once its dismissal ends. */
  dismissed: () => void
}

/**
 * Pastes a link to a recording elsewhere onto a tune. `tuneId` is null for a closed sheet;
 * the parent nulls it from `onClose`.
 */
export function usePasteLink(
  tuneId: string | null,
  {
    onClose,
    onInvalid,
  }: {
    onClose: () => void
    /** Runs when the typed link is refused, to move focus back to the field. */
    onInvalid?: () => void
  },
): PasteLink {
  const db = useDb()
  const engine = useSyncEngine()
  const analytics = useAnalytics()
  const { error, pending, runThen, clear } = useAction()
  const [url, setUrlState] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const sheet = useSheetSession(tuneId, {
    onOpen: () => {
      setUrlState('')
      setValidation(null)
      clear()
    },
    onClose,
  })

  const refuse = (message: string) => {
    clear()
    setValidation(message)
    onInvalid?.()
  }

  const submit = () => {
    if (!tuneId || !sheet.canSave()) return
    const trimmed = url.trim()
    if (!trimmed) return refuse(LINK_REQUIRED)
    if (outboundUrl({ url: trimmed }) === null) return refuse(LINK_NOT_WEB)
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
        const linkId = await addLink(db, target, {
          url: resolved?.url ?? trimmed,
          provider,
          provider_ref,
          title: resolved?.title ?? null,
          artwork_url: resolved?.artwork_url ?? null,
        })
        analytics.send('link_added', {
          service: serviceOf(provider),
          via: 'paste',
          link_id: linkId,
          tune_id: target,
        })
      } catch (caught) {
        sheet.saveFailed(caught)
      }
    }, sheet.close)
  }

  return {
    open: sheet.open,
    closing: sheet.closing,
    url,
    setUrl: (next) => {
      setUrlState(next)
      setValidation(null)
      clear()
    },
    validation,
    error,
    pending,
    submit,
    close: sheet.close,
    dismissed: sheet.dismissed,
  }
}
