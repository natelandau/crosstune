import { useSyncExternalStore } from 'react'
import { useStampedDensity } from './density'
import { keyPlatform } from './keyPlatform'
import { matches } from './mediaQuery'

/**
 * What Settings offers. `appStore`: Apple's badge on an iPhone or iPad, a row on a Mac, the
 * iPhone app as a row on another touch device or as a QR code on another computer, or nothing.
 * `webInstall`: the browser's install prompt.
 */
export interface InstallOffer {
  appStore: 'badge' | 'apple' | 'row' | 'qr' | 'none'
  webInstall: boolean
}

// No storefront segment, so Apple opens the visitor's own country's store.
export const APP_STORE_URL = 'https://apps.apple.com/app/id6817756289'

/** Chromium's install prompt event, which the DOM types do not include. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * The offer for a browser. An Apple device gets only the App Store, because the listing holds
 * the iPhone, iPad, and Mac app. Every other device offers the iPhone app, and a touch device
 * also offers the browser's install prompt.
 */
export function pickInstallOffer({
  apple,
  touch,
  installed,
  canPrompt,
}: {
  apple: boolean
  touch: boolean
  installed: boolean
  canPrompt: boolean
}): InstallOffer {
  if (apple) {
    return { appStore: installed ? 'none' : touch ? 'badge' : 'apple', webInstall: false }
  }
  if (!touch) return { appStore: 'qr', webInstall: false }
  return { appStore: 'row', webInstall: canPrompt && !installed }
}

let listening = false
let deferred: BeforeInstallPromptEvent | null = null
let installedHere = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/**
 * Holds the browser's install prompt for Settings. It starts with the page, because Chromium
 * sends the event once, early in the load. Returns a stop that clears what it held. A call while
 * it runs does nothing, so its stop cannot clear the first caller's state.
 */
export function startInstallOffer(): () => void {
  if (listening) return () => {}
  listening = true
  const onPrompt = (event: Event) => {
    // Without this, the browser shows its own install bar.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  }
  const onInstalled = () => {
    deferred = null
    installedHere = true
    notify()
  }
  window.addEventListener('beforeinstallprompt', onPrompt)
  window.addEventListener('appinstalled', onInstalled)
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt)
    window.removeEventListener('appinstalled', onInstalled)
    listening = false
    deferred = null
    installedHere = false
    notify()
  }
}

function runsInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return installedHere || standalone || matches('(display-mode: standalone)')
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Until the listener runs, nothing is offered, so a page that never starts it, such as a test or
// a screenshot, looks the same on every host.
const snapshot = () =>
  !listening ? 'off' : runsInstalled() ? 'installed' : deferred ? 'prompt' : 'idle'

/** Opens the browser's install prompt, once per event it sent. */
export async function install(): Promise<void> {
  const event = deferred
  if (!event) return
  // A prompt event opens once, so the entry hides whatever the person chooses.
  deferred = null
  notify()
  try {
    await event.prompt()
    await event.userChoice
  } catch {
    // Chromium refuses a prompt that has lost its user activation. The entry has hidden, and the
    // browser can send a new event.
  }
}

export function useInstallOffer(): InstallOffer {
  const state = useSyncExternalStore(subscribe, snapshot)
  const touch = useStampedDensity() === 'touch'
  if (state === 'off') return { appStore: 'none', webInstall: false }
  return pickInstallOffer({
    apple: keyPlatform() === 'mac',
    touch,
    installed: state === 'installed',
    canPrompt: state === 'prompt',
  })
}
