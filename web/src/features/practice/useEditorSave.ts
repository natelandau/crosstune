import { useEffect, useRef, useState } from 'react'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import type { LocalRecording } from '../../db/types'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { useLatest } from '../../ui/useLatest'

export interface EditorSaveOptions {
  recording: Pick<LocalRecording, 'trim_start_ms' | 'trim_end_ms'>
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  /** The row's trim changed while the editor was open. */
  onTrimmedElsewhere: () => void
  /** What the editor says when the write fails. */
  failure: string
}

export interface EditorSave {
  /** Asks `question`, then runs `write` unless the editor has given way meanwhile. */
  save: (question: Omit<ConfirmQuestion, 'signal'>, write: () => Promise<void>) => Promise<void>
  saving: boolean
  error: string | null
}

/**
 * The confirmed write an editor such as Trim or Split ends in. Every edit counts from the trim
 * the editor opened on, so a trim landing from elsewhere withdraws an open question and the
 * editor gives way rather than write somewhere the musician did not choose. The editor's own
 * write changes the trim too, which is not a trim from elsewhere.
 */
export function useEditorSave({
  recording,
  confirm,
  onTrimmedElsewhere,
  failure,
}: EditorSaveOptions): EditorSave {
  const [opened] = useState(() => ({ start: recording.trim_start_ms, end: recording.trim_end_ms }))
  const trimmedElsewhere =
    recording.trim_start_ms !== opened.start || recording.trim_end_ms !== opened.end
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const writing = useRef(false)
  const live = useRef(true)
  const question = useRef<AbortController | null>(null)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      question.current?.abort()
    }
  }, [])
  const staleRef = useLatest(trimmedElsewhere)
  const onTrimmedElsewhereRef = useLatest(onTrimmedElsewhere)
  useEffect(() => {
    if (!trimmedElsewhere || writing.current) return
    question.current?.abort()
    onTrimmedElsewhereRef.current()
  }, [trimmedElsewhere, onTrimmedElsewhereRef])

  const save = async (asked: Omit<ConfirmQuestion, 'signal'>, write: () => Promise<void>) => {
    const controller = new AbortController()
    question.current = controller
    const answer = await confirm({ ...asked, signal: controller.signal })
    if (question.current === controller) question.current = null
    if (!answer || !live.current || staleRef.current) return
    writing.current = true
    setSaving(true)
    setError(null)
    try {
      await write()
    } catch (caught) {
      writing.current = false
      setSaving(false)
      // A row that is gone takes practice with it, so there is nothing to report.
      if (caught instanceof Error && caught.message === RECORDING_NOT_FOUND) return
      setError(failure)
    }
  }

  return { save, saving, error }
}
