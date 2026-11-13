import { useState } from 'react'
import { TunePickerSheet } from '../catalog/TunePickerSheet'
import { useTuneMatches } from '../catalog/useTuneMatches'
import { addToTuneName, LINK_TO_TUNE } from './recordingsCopy'

/** The tune picker that files the selected recordings: a pick or a new tune links them all. */
export function LinkToTuneSheet({
  isOpen,
  onClose,
  onPick,
  onCreate,
}: {
  isOpen: boolean
  onClose: () => void
  onPick: (tune: { id: string; title: string }) => void
  onCreate: (title: string) => void
}) {
  const [query, setQuery] = useState('')
  const matches = useTuneMatches(query, isOpen)
  return (
    <TunePickerSheet
      title={LINK_TO_TUNE}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onClosed={() => setQuery('')}
      selection={{ mode: 'single' }}
      search={{ query, setQuery, matches }}
      onPick={(entry) => onPick({ id: entry.tune.id, title: entry.tune.title })}
      onCreate={onCreate}
      rowName={addToTuneName}
    />
  )
}
