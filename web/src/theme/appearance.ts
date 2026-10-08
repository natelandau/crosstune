import { useSyncExternalStore } from 'react'
import { matches } from '../platform/mediaQuery'
import { createStoredValue, onOtherTabWrite, readStored } from '../platform/storage'

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

function parseChoice<T extends string>(allowed: readonly T[], fallback: T) {
  return (raw: string | null): T => (allowed.includes(raw as T) ? (raw as T) : fallback)
}

const parseAppearance = parseChoice(APPEARANCES, 'system')
const parseTextSize = parseChoice(TEXT_SIZES, 'regular')

export function readAppearance(): Appearance {
  return parseAppearance(readStored(APPEARANCE_KEY))
}

export function readTextSize(): TextSize {
  return parseTextSize(readStored(TEXT_SIZE_KEY))
}

export function applyTextSize(size: TextSize): void {
  const root = document.documentElement
  if (size === 'regular') root.removeAttribute('data-text-size')
  else root.setAttribute('data-text-size', size)
}

const appearance = createStoredValue({
  key: APPEARANCE_KEY,
  parse: parseAppearance,
  serialize: String,
})
const textSize = createStoredValue({ key: TEXT_SIZE_KEY, parse: parseTextSize, serialize: String })

export const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveDark(appearance: Appearance): boolean {
  if (appearance === 'system') return matches(DARK_QUERY)
  return appearance === 'dark'
}

// Every tab follows a choice made in any one of them.
if (typeof window !== 'undefined') {
  onOtherTabWrite([APPEARANCE_KEY, TEXT_SIZE_KEY], () => {
    appearance.reload()
    textSize.reload()
    applyTextSize(textSize.get())
  })
}

export function setAppearance(next: Appearance): void {
  appearance.set(next)
}

export function setTextSize(next: TextSize): void {
  applyTextSize(next)
  textSize.set(next)
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(appearance.subscribe, appearance.get)
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(textSize.subscribe, textSize.get)
}
