import { useState } from 'react'
import { useToast } from '../../ui/Toast'
import { messageFor } from '../../ui/useAction'
import type { Source } from '../../usage/events'
import { useTuneMatches, type TuneMatches } from '../catalog/useTuneMatches'
import { useCreateTune } from '../tune/useCreateTune'

export interface FileRecording {
  query: string
  setQuery: (query: string) => void
  /** The catalog narrowed by the query, and what the search offers beyond the matches. */
  matches: TuneMatches
  /** Creates a tune by `title` and files the recording under it. */
  create: (title: string) => void
}

/**
 * Search for the tune a recording belongs to, or start a new one to file it under. A create
 * outlives the picker that asked for it, so a refusal shows as a toast.
 */
export function useFileRecording(recordingId: string, source: Source): FileRecording {
  const toast = useToast()
  const createTune = useCreateTune()
  const [query, setQuery] = useState('')
  const matches = useTuneMatches(query)

  const create = (title: string) => {
    createTune({ title, source, recordingId })
      .then(({ filingError }) => {
        if (filingError) toast.show(filingError)
      })
      .catch((caught: unknown) => toast.show(messageFor(caught)))
  }

  return { query, setQuery, matches, create }
}
