// The home page's one script: the hero's scenes, the feature captures, and the waitlist form.
import { mountFeatures } from './features'
import { mountHero } from './heroScenes'
import { followReducedMotion } from './playback'
import { loadClerk, mountWaitlist } from './waitlist'

const hero = document.querySelector<HTMLElement>('[data-hero]')
const features = document.querySelector<HTMLElement>('[data-features]')
followReducedMotion(matchMedia('(prefers-reduced-motion: reduce)'), (reducedMotion) => {
  const disposers = [
    hero ? mountHero(hero, { reducedMotion }) : () => {},
    features ? mountFeatures(features, { reducedMotion }) : () => {},
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
})

const form = document.querySelector<HTMLFormElement>('form[data-waitlist]')
if (form) mountWaitlist(form, () => loadClerk(import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY))
