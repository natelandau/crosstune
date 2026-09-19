import { useSyncExternalStore } from 'react'
import { syncStatusBar } from '../../platform/statusBar'

export const APPEARANCES = ['system', 'light', 'dark'] as const
export type Appearance = (typeof APPEARANCES)[number]

export const TEXT_SIZES = ['compact', 'regular', 'roomy'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  compact: 'Compact',
  regular: 'Regular',
  roomy: 'Roomy',
}

// Both are per device, like the remembered user, so they live in localStorage rather than
// the synced settings row. index.html reads the same keys before the first paint.
export const APPEARANCE_KEY = 'crosstune.appearance'
export const TEXT_SIZE_KEY = 'crosstune.textSize'

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the choice still applies until the page reloads.
  }
}

export function readAppearance(): Appearance {
  return read(APPEARANCE_KEY, APPEARANCES, 'system')
}

export function readTextSize(): TextSize {
  return read(TEXT_SIZE_KEY, TEXT_SIZES, 'regular')
}

export function applyTextSize(size: TextSize): void {
  const root = document.documentElement
  if (size === 'regular') root.removeAttribute('data-text-size')
  else root.setAttribute('data-text-size', size)
}

// Storage is read once per key. After that the value in memory is what the screen shows, so
// a choice made while storage is blocked still reads as chosen until the page reloads.
let appearance: Appearance | undefined
let textSize: TextSize | undefined

function currentAppearance(): Appearance {
  return (appearance ??= readAppearance())
}

function currentTextSize(): TextSize {
  return (textSize ??= readTextSize())
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveDark(appearance: Appearance): boolean {
  if (appearance === 'system') return window.matchMedia?.(DARK_QUERY).matches ?? false
  return appearance === 'dark'
}

/**
 * Ionic reads the palette from a class, so the class is what the choice becomes. The attribute
 * stays for the inline script in index.html and for anything that styles on the choice itself.
 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  if (appearance === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', appearance)
  root.classList.toggle('ion-palette-dark', resolveDark(appearance))
  syncStatusBar()
}

// A system choice must follow the device when it switches at sunset.
if (typeof window !== 'undefined') {
  window.matchMedia?.(DARK_QUERY).addEventListener('change', () => {
    if (currentAppearance() === 'system') applyAppearance('system')
  })
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const listener of listeners) listener()
}

// The storage event fires only in the other tabs of this origin, so each of them follows a
// choice made in any one of them. A null key is localStorage.clear().
function followOtherTabs(event: StorageEvent): void {
  if (event.key !== null && event.key !== APPEARANCE_KEY && event.key !== TEXT_SIZE_KEY) return
  appearance = readAppearance()
  textSize = readTextSize()
  applyAppearance(appearance)
  applyTextSize(textSize)
  notify()
}

if (typeof window !== 'undefined') window.addEventListener('storage', followOtherTabs)

export function setAppearance(next: Appearance): void {
  appearance = next
  write(APPEARANCE_KEY, next)
  applyAppearance(next)
  notify()
}

export function setTextSize(next: TextSize): void {
  textSize = next
  write(TEXT_SIZE_KEY, next)
  applyTextSize(next)
  notify()
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, currentAppearance)
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(subscribe, currentTextSize)
}
