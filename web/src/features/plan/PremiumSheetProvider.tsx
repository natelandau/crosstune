import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { PremiumEntry, PremiumReason } from '../../usage/events'
import { settingsPagePath } from '../settings/settingsPaths'
import { PremiumSheet } from './PremiumSheet'

export type { PremiumEntry, PremiumReason }

export interface PremiumSheetLauncher {
  /** Shows the Premium sheet for what a free account tapped, and where it tapped it. */
  open: (reason: PremiumReason, from: PremiumEntry) => void
}

const NOTHING: PremiumSheetLauncher = { open: () => {} }

const PremiumSheetContext = createContext<PremiumSheetLauncher>(NOTHING)

/** Holds the one Premium sheet, so any gated control can answer a tap with it. */
export function PremiumSheetProvider({
  navigate,
  children,
}: {
  navigate: (to: string) => void
  children: ReactNode
}) {
  const analytics = useAnalytics()
  const [shown, setShown] = useState<{ reason: PremiumReason | null; open: boolean }>({
    reason: null,
    open: false,
  })
  const close = () => setShown((current) => ({ ...current, open: false }))
  const launcher = useMemo<PremiumSheetLauncher>(
    () => ({
      open: (next, from) => {
        setShown({ reason: next, open: true })
        analytics.send('premium_sheet_shown', { reason: next, from })
      },
    }),
    [analytics],
  )
  return (
    <PremiumSheetContext value={launcher}>
      {children}
      <PremiumSheet
        open={shown.open}
        reason={shown.reason}
        onClose={close}
        // A sheet asked for again while it was leaving keeps its reason.
        onClosed={() =>
          setShown((current) => (current.open ? current : { ...current, reason: null }))
        }
        onSeePlan={() => {
          close()
          navigate(settingsPagePath('account'))
        }}
      />
    </PremiumSheetContext>
  )
}

/** The Premium sheet's launcher, which does nothing in a tree with no provider. */
// A context module pairs its provider component with the hook that reads it.
// eslint-disable-next-line react-refresh/only-export-components
export function usePremiumSheet(): PremiumSheetLauncher {
  return useContext(PremiumSheetContext)
}
