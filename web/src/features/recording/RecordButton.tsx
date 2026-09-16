import { useStartRecording } from './useStartRecording'

/** The Dock's center control and the only way to start a recording not already tied to a song. */
export function RecordButton() {
  const start = useStartRecording()
  return (
    <button
      type="button"
      className="record-button min-h-11 min-w-11"
      aria-label="Start a new recording"
      onClick={() => start()}
    >
      <span aria-hidden="true" className="record-button-dot" />
    </button>
  )
}
