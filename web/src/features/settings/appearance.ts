import { useSyncExternalStore } from 'react'

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

/** System means no attribute, which leaves the choice to prefers-color-scheme. */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  if (appearance === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', appearance)
}

export function applyTextSize(size: TextSize): void {
  const root = document.documentElement
  if (size === 'regular') root.removeAttribute('data-text-size')
  else root.setAttribute('data-text-size', size)
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const listener of listeners) listener()
}

export function setAppearance(appearance: Appearance): void {
  write(APPEARANCE_KEY, appearance)
  applyAppearance(appearance)
  notify()
}

export function setTextSize(size: TextSize): void {
  write(TEXT_SIZE_KEY, size)
  applyTextSize(size)
  notify()
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, readAppearance)
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(subscribe, readTextSize)
}
