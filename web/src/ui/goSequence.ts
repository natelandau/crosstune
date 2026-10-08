import { SHORTCUTS, typedKey, type KeyPress, type ShortcutId } from './keymap'

/** How long after G the destination letter still counts. */
export const GO_SEQUENCE_MS = 1500

export type GoTarget = 'catalog' | 'lists' | 'recordings' | 'settings'

const TARGETS: Partial<Record<ShortcutId, GoTarget>> = {
  goCatalog: 'catalog',
  goLists: 'lists',
  goRecordings: 'recordings',
  goSettings: 'settings',
}

const GO_SHORTCUTS = SHORTCUTS.filter((shortcut) => TARGETS[shortcut.id])
const START = GO_SHORTCUTS[0]!.keys[0]!.toLowerCase()

// Holding a modifier on its own is not a keystroke the musician means as part of the sequence.
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

const LETTERS = new Map(
  GO_SHORTCUTS.map((shortcut) => [shortcut.keys[1]!.toLowerCase(), TARGETS[shortcut.id]!]),
)

export interface GoSequence {
  /**
   * Reads one key press: `started` on G, the destination for its letter in time, `ended` when
   * any other key breaks the sequence, and null when no sequence is under way or the key is a
   * lone modifier. A shifted letter is any other key, and Caps Lock does not change a letter.
   */
  press(event: Pick<KeyPress, 'key' | 'shiftKey'>): 'started' | GoTarget | 'ended' | null
  reset(): void
}

/** The G-then-letter sequence, timed by `now` so a test can run its own clock. */
export function createGoSequence(now: () => number): GoSequence {
  let startedAt: number | null = null
  return {
    press(event) {
      if (MODIFIERS.has(event.key)) return null
      const key = typedKey(event)
      const live = startedAt !== null && now() - startedAt <= GO_SEQUENCE_MS
      if (key === START) {
        startedAt = now()
        return 'started'
      }
      startedAt = null
      if (!live) return null
      return LETTERS.get(key) ?? 'ended'
    },
    reset() {
      startedAt = null
    },
  }
}
