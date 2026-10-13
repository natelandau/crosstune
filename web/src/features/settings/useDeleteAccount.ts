import { useAuth } from '@clerk/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import type { PaidSource } from '../../billing/plan'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { useAction } from '../../ui/useAction'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { APP_STORE_SUBSCRIPTIONS_URL } from '../plan/planCopy'
import {
  confirmMatches,
  countAccountData,
  deleteAccountAndForget,
  deleteOutcomeUnknown,
} from './deleteAccount'
import {
  APPLE_SUBSCRIPTION_LINE,
  DELETE_FAILED,
  DELETE_UNCONFIRMED,
  SETTINGS_LINE,
  STRIPE_SUBSCRIPTION_LINE,
} from './deleteAccountCopy'

/** What deleting does to a subscription, and where an App Store subscriber cancels it. */
export interface SubscriptionNote {
  line: string
  link: string | null
}

/** What deleting does to each kind of paid subscription, and where to cancel one it leaves. */
const SUBSCRIPTIONS: Record<PaidSource, SubscriptionNote> = {
  stripe: { line: STRIPE_SUBSCRIPTION_LINE, link: null },
  apple: { line: APPLE_SUBSCRIPTION_LINE, link: APP_STORE_SUBSCRIPTIONS_URL },
}

/** One count line, or none for a zero count. */
function countLine(count: number, singular: string, plural: string): string | null {
  if (count <= 0) return null
  return `${count} ${count === 1 ? singular : plural}`
}

function linesFor(counts: { tunes: number; lists: number; recordings: number }): string[] {
  return [
    countLine(counts.tunes, 'tune', 'tunes'),
    countLine(counts.lists, 'list', 'lists'),
    countLine(counts.recordings, 'recording and its audio', 'recordings and their audio'),
    SETTINGS_LINE,
  ].filter((line): line is string => line !== null)
}

export interface DeleteAccount {
  text: string
  /** Also drops the last refusal, which no longer speaks to what is typed. */
  setText: (text: string) => void
  /** What is about to be lost, or null unless the counts are known, so it never understates. */
  countLines: string[] | null
  /** True until the local counts have been read or have failed to read. */
  loading: boolean
  /** What happens to each subscription still billing the account. */
  subscriptions: SubscriptionNote[]
  confirmed: boolean
  /** Does nothing until the confirmation text matches and the counts have settled. */
  run: () => void
  error: string | null
  pending: boolean
  /** True once the sheet should close: after Cancel, or after the account is gone. */
  closing: boolean
  close: () => void
}

/**
 * The last stop before an account and everything in it, on every device, is gone for good.
 * Opening resets the form; a failure keeps what was typed so a retry needs no retyping.
 */
export function useDeleteAccount(open: boolean): DeleteAccount {
  const db = useDb()
  const { userId } = useAuthSession()
  const { signOut } = useAuth()
  const engine = useSyncEngine()
  const analytics = useAnalytics()
  const { paidSources } = usePlanOrUnknown()
  const subscriptions = paidSources.map((source) => SUBSCRIPTIONS[source])
  const { error, pending, runThen, clear } = useAction()
  const [text, setText] = useState('')
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState(open)
  const deletedRef = useRef(false)
  // Read by `close`, which a second call in the same tick reaches before `closing` renders.
  const closedRef = useRef(false)
  // Undefined while loading; null when the local count could not be read, which must not
  // block a musician from deleting an account whose copy on this device is broken.
  const counts = useLiveQuery(
    () => (open ? countAccountData(db).catch(() => null) : undefined),
    [db, open],
  )
  const loading = counts === undefined

  if (open !== openedFor) {
    setOpenedFor(open)
    if (open) {
      setText('')
      setClosing(false)
      clear()
    }
  }

  useEffect(() => {
    if (!open) return
    deletedRef.current = false
    closedRef.current = false
    analytics.send('account_deletion_started', {})
  }, [open, analytics])

  const confirmed = confirmMatches(text)

  const run = () => {
    if (!confirmed || pending || loading) return
    runThen(
      () =>
        deleteAccountAndForget({
          db,
          userId,
          engine,
          signOut: () => signOut(),
          analytics,
        }).catch((cause: unknown) => {
          throw new Error(deleteOutcomeUnknown(cause) ? DELETE_UNCONFIRMED : DELETE_FAILED, {
            cause,
          })
        }),
      () => {
        deletedRef.current = true
        setClosing(true)
      },
    )
  }

  return {
    text,
    setText: (next) => {
      setText(next)
      clear()
    },
    countLines: counts ? linesFor(counts) : null,
    loading,
    subscriptions,
    confirmed,
    run,
    error,
    pending,
    closing,
    close: () => {
      if (!deletedRef.current && !closedRef.current) {
        analytics.send('account_deletion_cancelled', {})
      }
      closedRef.current = true
      setClosing(true)
    },
  }
}
