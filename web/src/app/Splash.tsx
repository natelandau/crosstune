import { LoaderCircle } from 'lucide-react'
import { Mark } from '../ui/Mark'
import { SPLASH_LABEL } from '../auth/links'

/** The one spinner the app allows: everywhere else loading is silence. */
export function Splash() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6">
      <Mark className="h-10" />
      <div role="status" aria-label={SPLASH_LABEL}>
        <LoaderCircle
          className="text-ink-2 size-6 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      </div>
    </main>
  )
}
