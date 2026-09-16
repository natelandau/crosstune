import { useEffect, useState, type FormEvent } from 'react'
import type { ResolveResponse } from '../../api/types'
import { addLink } from '../../commands/links'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { detectProvider, isProvider } from './detect'

export const RESOLVE_DEBOUNCE_MS = 400

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function AddLinkForm({ songId, onAdded }: { songId: string; onAdded?: () => void }) {
  const db = useDb()
  const engine = useSyncEngine()
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [preview, setPreview] = useState<ResolveResponse | null>(null)
  const { error, pending, runThen } = useAction()

  useEffect(() => {
    if (!looksLikeUrl(url)) return
    let cancelled = false
    const timer = setTimeout(() => {
      void engine.resolveLink(url.trim()).then((resolved) => {
        if (!cancelled) setPreview(resolved)
      })
    }, RESOLVE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [url, engine])

  function handleUrlChange(value: string) {
    setUrl(value)
    // Clear any stale preview immediately so it never outlives the url that produced it.
    setPreview(null)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!looksLikeUrl(url)) return
    const detected = detectProvider(url)
    // A provider the resolver returned that this client doesn't recognize can't carry
    // that provider's ref either, since the ref format is provider-specific.
    const { provider, provider_ref } =
      preview && isProvider(preview.provider)
        ? { provider: preview.provider, provider_ref: preview.provider_ref }
        : { provider: detected.provider, provider_ref: detected.provider_ref }
    runThen(
      () =>
        addLink(db, songId, {
          url: preview?.url ?? url.trim(),
          provider,
          provider_ref,
          title: preview?.title ?? null,
          artwork_url: preview?.artwork_url ?? null,
          label: label.trim() || null,
        }),
      () => {
        setUrl('')
        setLabel('')
        setPreview(null)
        onAdded?.()
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <fieldset className="fieldset">
        <legend className="fieldset-legend">Link</legend>
        <label className="input w-full">
          <input
            className="grow"
            type="url"
            inputMode="url"
            aria-label="Link"
            maxLength={2048}
            placeholder="Paste a YouTube, Spotify, or other link"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
          />
        </label>
      </fieldset>
      {preview?.title ? (
        <p className="text-meta flex items-center gap-2">
          {preview.artwork_url ? (
            <img src={preview.artwork_url} alt="" className="h-8 w-8 rounded object-cover" />
          ) : null}
          <span>{preview.title}</span>
        </p>
      ) : null}
      <fieldset className="fieldset">
        <legend className="fieldset-legend">Label</legend>
        <label className="input w-full">
          <input
            className="grow"
            type="text"
            aria-label="Label"
            maxLength={200}
            placeholder="slow version, jam recording, ..."
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      </fieldset>
      <button
        type="submit"
        className="btn btn-primary min-h-11 w-full"
        disabled={pending || !looksLikeUrl(url)}
      >
        Add link
      </button>
      {error ? (
        <p role="alert" className="text-error text-meta">
          {error}
        </p>
      ) : null}
    </form>
  )
}
