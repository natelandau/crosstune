import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { SONG_LIMITS } from '../song/limits'
import type { RecordingView } from './useRecordings'

/** A single text box for a recording's name. Saving a blank name clears it. */
export function RenameSheet({
  view,
  onClose,
  onSave,
}: {
  view: RecordingView | null
  onClose: () => void
  onSave: (id: string, label: string | null) => void
}) {
  return (
    <Sheet open={view !== null} title="Rename recording" onClose={onClose}>
      {view ? (
        // Keyed on the recording so each opening starts from its stored name, whatever a
        // cancelled edit left in the box.
        <RenameForm
          key={view.recording.id}
          initial={view.recording.label ?? ''}
          onCancel={onClose}
          onSubmit={(label) => onSave(view.recording.id, label)}
        />
      ) : null}
    </Sheet>
  )
}

function RenameForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string
  onCancel: () => void
  onSubmit: (label: string | null) => void
}) {
  const [label, setLabel] = useState(initial)
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(label.trim() || null)
      }}
    >
      <label className="input min-h-11 w-full">
        <input
          className="grow"
          aria-label="Recording name"
          value={label}
          maxLength={SONG_LIMITS.title}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn min-h-11 flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary min-h-11 flex-1">
          Save
        </button>
      </div>
    </form>
  )
}
