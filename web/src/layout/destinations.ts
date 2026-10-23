import { PHONE_TABS, TABS } from './tabs'
import type { LucideIcon } from 'lucide-react'
import { readStored as readStorage, writeStored } from '../platform/storage'

export type Destination = (typeof TABS)[number]['tab']

export interface DestinationSpec {
  id: Destination
  label: string
  icon: LucideIcon
  root: string
}

export const DESTINATIONS: DestinationSpec[] = TABS.map((tab) => ({
  id: tab.tab,
  label: tab.label,
  icon: tab.icon,
  root: tab.href,
}))

/** The spec for one destination. */
export function destination(id: Destination): DestinationSpec {
  return DESTINATIONS.find((d) => d.id === id)!
}

const STORAGE_KEY = 'crosstune.destinations'

/** The destination a path belongs to, or null for paths outside them all, such as `/`. */
export function destinationOf(pathname: string): Destination | null {
  const first = pathname.split('/')[1]
  return DESTINATIONS.find((d) => d.id === first)?.id ?? null
}

/** Reads the session's mirror, dropping anything malformed or filed under the wrong destination. */
export function readStored(): Partial<Record<Destination, string>> {
  try {
    const parsed: unknown = JSON.parse(readStorage(STORAGE_KEY, 'session') ?? '{}')
    if (typeof parsed !== 'object' || parsed === null) return {}
    const memory: Partial<Record<Destination, string>> = {}
    for (const { id } of DESTINATIONS) {
      const value = (parsed as Record<string, unknown>)[id]
      if (typeof value === 'string' && destinationOf(value.split(/[?#]/)[0] ?? value) === id)
        memory[id] = value
    }
    return memory
  } catch {
    return {}
  }
}

// Session-scoped so a reload keeps each destination's place, while a new tab starts at roots.
let memory = readStored()

type PhoneTab = (typeof PHONE_TABS)[number]

const isPhoneTab = (destination: Destination): destination is PhoneTab =>
  (PHONE_TABS as readonly Destination[]).includes(destination)

// Page-scoped, unlike the places: a reload onto Settings has no tab it came from.
let lastTabShown: PhoneTab | null = null

export function rememberLocation(destination: Destination, location: string) {
  memory[destination] = location
  if (isPhoneTab(destination)) lastTabShown = destination
  // Blocked storage drops the write; the in-memory map still serves this page load.
  writeStored(STORAGE_KEY, JSON.stringify(memory), 'session')
}

export function rememberedLocation(destination: Destination): string | undefined {
  return memory[destination]
}

/** The phone tab shown last, which Settings goes back to on the phone, or the catalog. */
export function lastTab(): PhoneTab {
  return lastTabShown ?? 'catalog'
}

/** Where the phone tab shown last was left, for Settings' Back on the phone. */
export function lastTabRoot(): string {
  const tab = lastTab()
  return memory[tab] ?? destination(tab).root
}

export function resetDestinationsForTest() {
  memory = {}
  lastTabShown = null
}
