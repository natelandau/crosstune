import { useId } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { RECORD_LABEL, RECORD_TEXT } from './tabs'
import { useShellCovered } from '../ui/overlayClaim'
import { RECORD_UNAVAILABLE, useRecordLauncher } from './recordLauncher'

/**
 * The shell's one Record control: a raised dome on the phone's bar, a capsule at the sidebar's
 * foot. It stands down behind any sheet or dialog, and while recording cannot start it stays
 * in place, disabled, with the reason as its description. A selecting screen takes the tab bar,
 * dome and all, while the sidebar's capsule stays.
 */
export function RecordControl({ shape }: { shape: 'dome' | 'capsule' }) {
  const { start, available } = useRecordLauncher()
  const covered = useShellCovered()
  const reasonId = useId()
  const dome = shape === 'dome'
  return (
    <div
      data-testid="record-control"
      data-record-control
      aria-hidden={covered || undefined}
      inert={covered}
      className={dome ? 'justify-self-center' : 'self-start'}
    >
      <AriaButton
        aria-label={RECORD_LABEL}
        aria-describedby={available ? undefined : reasonId}
        isDisabled={!available}
        onPress={() => start()}
        className={`group ${
          dome
            ? 'bg-ground border-hairline -mt-6 inline-flex size-14 shrink-0 items-center justify-center rounded-full border shadow-(--shadow-float) transition-opacity duration-(--dur-short) ease-(--ease) data-[pressed]:opacity-60'
            : 't-body bg-fill text-ink inline-flex min-h-(--target-control) items-center gap-2 rounded-(--radius-capsule) px-4 transition-opacity duration-(--dur-short) ease-(--ease) disabled:opacity-60 data-[pressed]:opacity-60'
        }`}
      >
        <span
          aria-hidden
          className={`bg-record rounded-full group-disabled:opacity-40 ${dome ? 'size-5' : 'size-3'}`}
        />
        {!dome && <span aria-hidden>{RECORD_TEXT}</span>}
      </AriaButton>
      {!available && (
        <span id={reasonId} hidden>
          {RECORD_UNAVAILABLE}
        </span>
      )}
    </div>
  )
}
