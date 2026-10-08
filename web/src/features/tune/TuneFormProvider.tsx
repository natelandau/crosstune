import { useMemo, useState, type ReactNode } from 'react'
import { listTunePath, tuneHomePath } from '../../app/tuneHome'
import { useToast } from '../../ui/Toast'
import {
  TuneFormLauncherProvider,
  type TuneFormLauncher,
  type TuneFormOptions,
} from './formLauncher'
import { TuneFormSheet } from './TuneFormSheet'

/**
 * The tune form behind `useTuneFormLauncher`. A new tune opens on its page once saved, in its
 * list when it was added from one, unless the form was cancelled while it saved. A tune made
 * to take a recording leaves the musician where they were.
 */
export function TuneFormProvider({
  navigate,
  children,
}: {
  navigate: (to: string) => void
  children: ReactNode
}) {
  const toast = useToast()
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
      {shown && (
        <TuneFormSheet
          {...shown}
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          onSaved={(tuneId, { filingError, dismissed }) => {
            // A tune the list refused is not in it, so it opens in the catalog instead.
            if (shown.tuneId === undefined && shown.recordingId === undefined && !dismissed) {
              navigate(
                shown.listId && !filingError
                  ? listTunePath(shown.listId, tuneId)
                  : tuneHomePath(tuneId),
              )
            }
            if (filingError) toast.show(filingError)
          }}
        />
      )}
    </TuneFormLauncherProvider>
  )
}
