import { X } from 'lucide-react'

export function SelectionBar({
  count,
  allSelected,
  onCancel,
  onToggleAll,
}: {
  count: number
  allSelected: boolean
  onCancel: () => void
  onToggleAll: () => void
}) {
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-circle min-h-11 min-w-11"
        aria-label="Cancel selection"
        onClick={onCancel}
      >
        <X aria-hidden="true" className="size-5" />
      </button>
      <p className="text-brand flex-1" aria-live="polite">
        {/* A new key per count replays the drop-in for each change. */}
        <span key={count} className="motion-safe:animate-select-count inline-block">
          {count} selected
        </span>
      </p>
      <button type="button" className="btn btn-ghost min-h-11" onClick={onToggleAll}>
        {allSelected ? 'Deselect all' : 'Select all'}
      </button>
    </>
  )
}
