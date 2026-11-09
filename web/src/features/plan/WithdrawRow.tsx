import { useState } from 'react'
import type { WithdrawOutcome } from '../../sync/types'
import { useSyncEngine } from '../../sync/SyncProvider'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { ButtonRow } from '../../ui/form/ButtonRow'
import { useToast } from '../../ui/Toast'
import { useAction } from '../../ui/useAction'
import type { TrackWork } from '../../ui/useWorking'
import {
  WITHDRAW_CONFIRM_ACTION,
  WITHDRAW_CONFIRM_BODY,
  WITHDRAW_CONFIRM_TITLE,
  WITHDRAW_DONE,
  WITHDRAW_ALREADY,
  WITHDRAW_FAILED,
  WITHDRAW_LABEL,
  WITHDRAW_REFUSED,
  WITHDRAW_WINDOW_CLOSED,
  withdrawUntil,
} from './planCopy'

const REFUSALS: Record<Exclude<WithdrawOutcome, 'withdrawn'>, string> = {
  window_closed: WITHDRAW_WINDOW_CLOSED,
  already_withdrawn: WITHDRAW_ALREADY,
  refused: WITHDRAW_REFUSED,
  failed: WITHDRAW_FAILED,
}

/** Refunds the first web payment and ends Premium, after a confirmation. */
export function WithdrawRow({ until }: { until: Date }) {
  const engine = useSyncEngine()
  const confirm = useConfirm()
  const toast = useToast()
  const { error, attempt } = useAction()
  // Stays off after a refund until the plan change removes the row, so a second press cannot ask.
  const [withdrawn, setWithdrawn] = useState(false)

  async function withdraw() {
    const outcome = await engine.withdraw()
    if (outcome !== 'withdrawn') throw new Error(REFUSALS[outcome])
  }

  async function press(track: TrackWork) {
    const ok = await confirm({
      title: WITHDRAW_CONFIRM_TITLE,
      message: WITHDRAW_CONFIRM_BODY,
      action: WITHDRAW_CONFIRM_ACTION,
    })
    // The plan ends with the refund and this row goes with it, so the toast carries the news.
    if (ok)
      void track(
        attempt(withdraw, () => {
          setWithdrawn(true)
          toast.show(WITHDRAW_DONE)
        }),
      )
  }

  return (
    <div>
      <ButtonRow
        description={withdrawUntil(until)}
        button={{
          label: WITHDRAW_LABEL,
          isDisabled: withdrawn,
          showDone: false,
          onPress: (track) => void press(track),
        }}
      />
      <ErrorLine error={error} place="field" />
    </div>
  )
}
