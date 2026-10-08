import { Maximize2 } from 'lucide-react'
import { formatDuration } from '../../text/format'
import { ELAPSED, OPEN_RECORDING, REMAINING } from './transportCopy'
import type { RecordingTransport } from './useRecordingTransport'
import { Button } from '../../ui/Button'
import { CloseButton, MessageLine, PlayToggle, RetryButton, type BarProps } from './barParts'
import { QueueControls } from './QueueControls'
import { Scrubber } from './Scrubber'
import { transportNotice } from './transportNotice'

/**
 * Now playing on split and wide: a 48px bar across the foot of the detail pane, edge to edge.
 * Play and Pause, the title, the scrubber between the elapsed and remaining times, the list's
 * controls while a list plays, then Expand and Close trailing.
 */
export function DockBar({ title, transport, onOpen, onClose, message }: Omit<BarProps, 'detail'>) {
  if (message) {
    return (
      <div data-dock-bar className="flex h-12 items-center gap-2 px-3">
        <MessageLine message={message} />
        <CloseButton onClose={onClose} />
      </div>
    )
  }
  return (
    <div data-dock-bar className="flex h-12 items-center gap-2 px-3">
      {transport && <PlayToggle transport={transport} />}
      <span className="t-body max-w-[40%] min-w-0 shrink truncate">{title}</span>
      {transport ? <Place transport={transport} title={title} /> : <span className="flex-1" />}
      <QueueControls tone="dock" />
      {transport && (
        <Button
          icon={Maximize2}
          label={OPEN_RECORDING(title)}
          iconOnly
          isDisabled={!onOpen}
          onPress={() => onOpen?.()}
        />
      )}
      <CloseButton onClose={onClose} />
    </div>
  )
}

/** Where the recording is, or why it cannot play yet. */
function Place({ transport, title }: { transport: RecordingTransport; title: string }) {
  const notice = transportNotice(transport)
  if (notice) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span role="status" className="t-secondary text-ink-2 min-w-0 truncate">
          {notice}
        </span>
        <RetryButton transport={transport} />
      </span>
    )
  }
  const { state, remainingMs } = transport
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span
        role="timer"
        aria-live="off"
        aria-label={ELAPSED(formatDuration(state.positionMs))}
        className="t-caption t-num text-ink-2 shrink-0"
      >
        {formatDuration(state.positionMs)}
      </span>
      <Scrubber
        title={title}
        positionMs={state.positionMs}
        lengthMs={state.lengthMs}
        onSeek={transport.seek}
      />
      <span
        role="timer"
        aria-live="off"
        aria-label={REMAINING(formatDuration(remainingMs))}
        className="t-caption t-num text-ink-2 shrink-0"
      >
        {/* The true minus, so the sign keeps one width beside the elapsed time. */}
        {`−${formatDuration(remainingMs)}`}
      </span>
    </span>
  )
}
