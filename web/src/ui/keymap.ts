import { RECORD_TEXT, tabLabel } from '../app/tabs'
import { SEARCH_TUNES } from '../features/catalog/catalogCopy'
import { NEW_TUNE_TITLE } from '../features/tune/tuneFormCopy'
import type { KeyPlatform } from '../platform/keyPlatform'

export const QUICK_FIND = 'Quick Find'
export const SHORTCUTS_TITLE = 'Keyboard shortcuts'
export const PLAY_OR_PAUSE = 'Play or pause'
export const STEP_OUT = 'Step out'
/** The group of shortcuts that go to a destination, and the words before each one's name. */
export const GO_TO = 'Go to'

export type ShortcutId =
  | 'quickFind'
  | 'search'
  | 'newTune'
  | 'record'
  | 'shortcuts'
  | 'goCatalog'
  | 'goLists'
  | 'goRecordings'
  | 'goSettings'
  | 'playPause'
  | 'stepOut'

export type ShortcutGroup = 'General' | typeof GO_TO | 'Playback'

export interface Shortcut {
  id: ShortcutId
  /** Pressed together for Quick Find, one after another for Go to. */
  keys: string[]
  label: string
  group: ShortcutGroup
}

/** The platform's command modifier, Cmd on a Mac and Ctrl elsewhere. */
const COMMAND_KEY = 'Meta'

/** Every shortcut, in the order the shortcut sheet shows it. */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'quickFind', keys: [COMMAND_KEY, 'K'], label: QUICK_FIND, group: 'General' },
  { id: 'search', keys: ['/'], label: SEARCH_TUNES, group: 'General' },
  { id: 'newTune', keys: ['N'], label: NEW_TUNE_TITLE, group: 'General' },
  { id: 'record', keys: ['R'], label: RECORD_TEXT, group: 'General' },
  { id: 'shortcuts', keys: ['?'], label: SHORTCUTS_TITLE, group: 'General' },
  { id: 'stepOut', keys: ['Escape'], label: STEP_OUT, group: 'General' },
  { id: 'goCatalog', keys: ['G', 'C'], label: tabLabel('catalog'), group: GO_TO },
  { id: 'goLists', keys: ['G', 'L'], label: tabLabel('lists'), group: GO_TO },
  { id: 'goRecordings', keys: ['G', 'R'], label: tabLabel('recordings'), group: GO_TO },
  { id: 'goSettings', keys: ['G', 'S'], label: tabLabel('settings'), group: GO_TO },
  { id: 'playPause', keys: ['Space'], label: PLAY_OR_PAUSE, group: 'Playback' },
]

/** The shortcut with `id`, from the one table. */
export const shortcutById = (id: ShortcutId): Shortcut =>
  SHORTCUTS.find((shortcut) => shortcut.id === id)!

/** Whether a shortcut's keys are pressed one after another, such as G then L, not together. */
export const isSequence = (shortcut: Shortcut) =>
  shortcut.keys.length > 1 && shortcut.keys[0] !== COMMAND_KEY

/** The `event.key` a table key arrives as: letters lowercase, Space as a space. */
const eventKey = (key: string) =>
  key === 'Space' ? ' ' : /^[A-Z]$/.test(key) ? key.toLowerCase() : key

// A symbol's Shift depends on the layout (`/` is Shift-7 on some), so only its character counts.
const isSymbol = (key: string) => key.length === 1 && !/^[a-z ]$/i.test(key)

/** A key as the musician sees it on a key cap. */
export function keyLabel(key: string, platform: KeyPlatform): string {
  if (key === COMMAND_KEY) return platform === 'mac' ? '⌘' : 'Ctrl'
  if (key === 'Escape') return 'Esc'
  if (key === ' ' || key === 'Space') return 'Space'
  return key.length === 1 ? key.toUpperCase() : key
}

const SPOKEN_SYMBOLS: Record<string, string> = { '?': 'Question mark', '/': 'Slash' }

/** A key as assistive technology speaks it, where its cap shows a glyph or an abbreviation. */
export function keySpoken(key: string, platform: KeyPlatform): string {
  if (key === COMMAND_KEY) return platform === 'mac' ? 'Command' : 'Control'
  if (key === 'Escape') return 'Escape'
  return SPOKEN_SYMBOLS[key] ?? keyLabel(key, platform)
}

export interface KeyPress {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * The character a press types, with a letter's case set by Shift alone, so Caps Lock never
 * turns a shortcut's letter into a shifted one, and Shift always does.
 */
export function typedKey({ key, shiftKey }: Pick<KeyPress, 'key' | 'shiftKey'>): string {
  if (key.length !== 1) return key
  return shiftKey ? key.toUpperCase() : key.toLowerCase()
}

/**
 * The shortcut a key press asks for: a single key with no modifier, or the command key with K.
 * A shifted letter stands down, and Caps Lock does not change a letter. The go sequence's
 * letters are `goSequence`'s to read.
 */
export function matchShortcut(event: KeyPress, platform: KeyPlatform): ShortcutId | null {
  const command = platform === 'mac' ? event.metaKey : event.ctrlKey
  const otherCommand = platform === 'mac' ? event.ctrlKey : event.metaKey
  if (event.altKey || otherCommand) return null
  const key = typedKey(event)
  for (const { id, keys } of SHORTCUTS) {
    if (keys[0] === COMMAND_KEY) {
      if (command && !event.shiftKey && key === eventKey(keys[1]!)) return id
    } else if (keys.length === 1 && !command && key === eventKey(keys[0]!)) {
      if (isSymbol(key) || !event.shiftKey) return id
    }
  }
  return null
}
