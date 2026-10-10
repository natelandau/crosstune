// The home page's one script: the demos and the waitlist forms.
import { mountDemos } from './demos'
import { followReducedMotion } from './reducedMotion'
import { loadClerk, mountWaitlist } from './waitlist'

followReducedMotion(matchMedia('(prefers-reduced-motion: reduce)'), (reducedMotion) =>
  mountDemos(document, { reducedMotion }),
)

// Both forms share one Clerk load, so focusing either one warms it for the other.
let clerk: ReturnType<typeof loadClerk> | null = null
const load = () => {
  clerk ??= loadClerk(import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY).catch((error: unknown) => {
    clerk = null
    throw error
  })
  return clerk
}
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-waitlist]')) {
  mountWaitlist(form, load)
}
