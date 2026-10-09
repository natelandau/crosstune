import { useId } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { RECORD_LABEL, RECORD_TEXT } from './tabs'
import { useShellCovered } from '../ui/overlayClaim'
import { RECORD_UNAVAILABLE, useRecordLauncher } from './recordLauncher'

/**
 * The shell's one Record control: a floating disc beside the phone's tabs, a capsule at the
 * sidebar's foot. It stands down behind any sheet or dialog, and while recording cannot start
 * it stays in place, disabled, with the reason as its description. A selecting screen takes
 * the tab bar, disc and all, while the sidebar's capsule stays.
 */
export function RecordControl({ shape }: { shape: 'disc' | 'capsule' }) {
  const { start, available } = useRecordLauncher()
  const covered = useShellCovered()
  const reasonId = useId()
  const disc = shape === 'disc'
  return (
    <div
      data-testid="record-control"
      data-record-control
      aria-hidden={covered || undefined}
      inert={covered}
      className={disc ? 'shrink-0' : undefined}
    >
      <AriaButton
        aria-label={RECORD_LABEL}
        aria-describedby={available ? undefined : reasonId}
        isDisabled={!available}
        onPress={() => start({ source: 'dock' })}
        className={`group ${
          disc
            ? 'bg-nav border-hairline inline-flex size-[62px] items-center justify-center rounded-full border transition-opacity duration-(--dur-short) ease-(--ease) data-[pressed]:opacity-60'
            : 't-body bg-fill text-ink flex min-h-(--target-control) w-full items-center justify-center gap-2 rounded-(--radius-capsule) px-4 transition-opacity duration-(--dur-short) ease-(--ease) disabled:opacity-60 data-[pressed]:opacity-60'
        }`}
      >
        <span
          aria-hidden
          className={`bg-record rounded-full group-disabled:opacity-40 ${disc ? 'size-6' : 'size-3'}`}
        />
        {!disc && <span aria-hidden>{RECORD_TEXT}</span>}
      </AriaButton>
      {!available && (
        <span id={reasonId} hidden>
          {RECORD_UNAVAILABLE}
        </span>
      )}
    </div>
  )
}
