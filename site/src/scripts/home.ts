// The home page's one script: the chapter demos and the waitlist form.
import { mountCatalog } from './catalog'
import { mountPractice } from './practice'
import { mountRecord } from './record'
import { loadClerk, mountWaitlist } from './waitlist'

const mounts: [string, (root: HTMLElement) => void][] = [
  ['[data-catalog]', mountCatalog],
  ['[data-record]', mountRecord],
  ['[data-player]', mountPractice],
]

for (const [selector, mount] of mounts) {
  const root = document.querySelector<HTMLElement>(selector)
  if (root) mount(root)
}

const form = document.querySelector<HTMLFormElement>('form[data-waitlist]')
if (form) mountWaitlist(form, () => loadClerk(import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY))
