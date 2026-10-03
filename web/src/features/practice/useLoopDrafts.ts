import { useRef, useState } from 'react'
import { updateLoop } from '../../commands/loops'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLoop } from '../../db/types'
import { useLatest } from '../../ui/useLatest'
import { rowSpan, spanFields, spanOf, type Draft, type Span } from './loopModel'
import type { LoopPlayback } from './useLoopPlayback'

const sameSpan = (row: LocalRecordingLoop, span: Span) =>
  row.start_ms === span.startMs && row.end_ms === span.endMs

/**
 * A handle's drag shows as a draft until its one write lands in the row. Each draft keeps the
 * row's span from when it was drawn as `base`, and gives way once its row holds the drafted
 * span or has moved off `base` (a write, this device's or a newer one, has landed), so a write
 * never flickers back and a newer value is never hidden. The draft a drag is still drawing
 * waits for the drag to end. Times are on the source timeline.
 */
export function useLoopDrafts({
  rows,
  playback,
  playheadMs,
  onError,
}: {
  rows: readonly LocalRecordingLoop[]
  playback: LoopPlayback
  playheadMs: number
  /** A refused write. */
  onError: (error: unknown) => void
}): {
  drafts: Record<string, { span: Span; base: Span }>
  onDraft: (draft: Draft | null) => void
  onCommit: (draft: Draft) => void
} {
  const db = useDb()
  const [drafts, setDrafts] = useState<Record<string, { span: Span; base: Span }>>({})
  const active = useRef<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const landed = Object.keys(drafts).filter((id) => {
    const row = rows.find((loop) => loop.id === id)
    if (!row) return true
    const { span, base } = drafts[id]!
    return sameSpan(row, span) || (id !== activeKey && !sameSpan(row, base))
  })
  if (landed.length > 0) {
    setDrafts((current) => {
      const next = { ...current }
      for (const id of landed) delete next[id]
      return next
    })
  }
  const latestDraftsRef = useLatest(drafts)
  const putDraft = (id: string, span: Span) => {
    const row = rows.find((loop) => loop.id === id)
    if (!row) return
    setDrafts((current) => ({
      ...current,
      [id]: { span, base: current[id]?.base ?? rowSpan(row) },
    }))
  }
  const dropDraft = (id: string) =>
    setDrafts((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  const setActive = (id: string | null) => {
    active.current = id
    setActiveKey(id)
  }

  const onDraft = (draft: Draft | null) => {
    if (!draft) {
      const id = active.current
      setActive(null)
      if (id === null) return
      dropDraft(id)
      if (id === playback.selectedId) playback.hold(id, null)
      return
    }
    if (draft.id === null) return
    setActive(draft.id)
    const span = spanOf(draft)
    putDraft(draft.id, span)
    // A repeating loop follows the drag while the playhead stays inside it; one dragged off
    // the playhead takes it along on release.
    if (draft.id === playback.selectedId && playheadMs >= span.startMs && playheadMs < span.endMs) {
      playback.hold(draft.id, span)
    }
  }

  const onCommit = (draft: Draft) => {
    setActive(null)
    const id = draft.id
    if (id === null) return
    const span = spanOf(draft)
    const row = rows.find((loop) => loop.id === id)
    if (!row || sameSpan(row, span)) {
      dropDraft(id)
      if (id === playback.selectedId) playback.hold(id, null)
      return
    }
    putDraft(id, span)
    if (id === playback.selectedId) playback.hold(id, span)
    const letGo = () => {
      dropDraft(id)
      if (id === playback.selectedId) playback.hold(id, null)
    }
    updateLoop(db, id, spanFields(span))
      .then(async () => {
        // A write that changed nothing (its row deleted meanwhile, say) never lands in the
        // row, so its draft would otherwise wait forever. A newer draft is left alone.
        const stored = await db.recording_loops.get(id)
        if (stored && !stored.deleted_at && sameSpan(stored, span)) return
        const drafted = latestDraftsRef.current[id]?.span
        if (drafted && drafted.startMs === span.startMs && drafted.endMs === span.endMs) letGo()
      })
      .catch((error: unknown) => {
        letGo()
        onError(error)
      })
  }

  return { drafts, onDraft, onCommit }
}
