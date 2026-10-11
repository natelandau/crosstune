import { useLiveQuery } from 'dexie-react-hooks'
import { useId } from 'react'
import { useDb } from '../../db/DbProvider'
import { readScanTune } from '../../db/scans'
import type { PremiumReason } from '../../usage/events'
import { Sheet } from '../../ui/Sheet'
import {
  PREMIUM_RECORDINGS_BODY,
  PREMIUM_RECORDINGS_TITLE,
  PREMIUM_SCANS_TITLE,
  premiumScansBody,
  SEE_PLAN,
} from './planCopy'

const TITLES: Record<PremiumReason, string> = {
  recordings: PREMIUM_RECORDINGS_TITLE,
  scans: PREMIUM_SCANS_TITLE,
}

/**
 * The title of the one tune a free account's scans open on, read only while asked for:
 * undefined until read, and the title null when there is no scan tune.
 */
function useScanTuneTitle(asked: boolean): { title: string | null } | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!asked) return undefined
    const tuneId = await readScanTune(db)
    return { title: tuneId === null ? null : ((await db.tunes.get(tuneId))?.title ?? null) }
  }, [db, asked])
}

/**
 * Answers a tap on something a free account cannot use with what Premium holds, headed by what
 * was tapped, and the way to the Plan group.
 */
export function PremiumSheet({
  open,
  reason,
  onClose,
  onClosed,
  onSeePlan,
}: {
  open: boolean
  /** Kept until the sheet has left, so it does not change as it closes; null once it has. */
  reason: PremiumReason | null
  onClose: () => void
  onClosed: () => void
  onSeePlan: () => void
}) {
  const bodyId = useId()
  const scan = useScanTuneTitle(reason === 'scans')
  const body =
    reason === 'recordings'
      ? PREMIUM_RECORDINGS_BODY
      : reason === 'scans' && scan?.title
        ? premiumScansBody(scan.title)
        : null
  // The scans sheet waits for its tune's title, so it opens with its body already in place.
  const ready = reason === 'recordings' || (reason === 'scans' && scan !== undefined)
  return (
    <Sheet
      isOpen={open && ready}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={reason ? TITLES[reason] : ''}
      height="part"
      describedBy={body ? bodyId : undefined}
      primary={{ label: SEE_PLAN, onPress: onSeePlan }}
      onClosed={onClosed}
    >
      {body && (
        <p id={bodyId} className="t-body pt-2">
          {body}
        </p>
      )}
    </Sheet>
  )
}
