import { useMemo, useState, type ReactNode } from 'react'
import {
  TuneFormLauncherProvider,
  type TuneFormLauncher,
  type TuneFormOptions,
} from './formLauncher'
import { TuneFormSheet } from './TuneFormSheet'

/** The tune form behind `useTuneFormLauncher`. */
export function TuneFormProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<TuneFormOptions | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const launcher = useMemo<TuneFormLauncher>(
    () => ({
      open: (options) => {
        setShown(options)
        setIsOpen(true)
      },
    }),
    [],
  )
  return (
    <TuneFormLauncherProvider value={launcher}>
      {children}
      {/* Kept after closing, so the sheet keeps its title and fields while it leaves. */}
      {shown && <TuneFormSheet {...shown} isOpen={isOpen} onOpenChange={setIsOpen} />}
    </TuneFormLauncherProvider>
  )
}
