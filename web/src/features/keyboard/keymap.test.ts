import { describe, expect, it } from 'vitest'
import { RECORD_TEXT, TABS } from '../../app/tabs'
import { SEARCH_TUNES } from '../catalog/catalogCopy'
import { NEW_TUNE_TITLE } from '../tune/tuneFormCopy'
import {
  GO_TO,
  isSequence,
  keyLabel,
  keySpoken,
  matchShortcut,
  SHORTCUTS,
  SHORTCUTS_TITLE,
} from './keymap'

const press = (
  key: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>> = {},
) => ({
  key,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
})

describe('matchShortcut', () => {
  it('maps a bare letter to its shortcut', () => {
    expect(matchShortcut(press('n'), 'mac')).toBe('newTune')
    expect(matchShortcut(press('r'), 'other')).toBe('record')
  })

  it('stands down for a shifted letter', () => {
    expect(matchShortcut(press('N', { shift: true }), 'mac')).toBeNull()
  })

  it('maps Cmd-K on a Mac and Ctrl-K elsewhere to Quick Find', () => {
    expect(matchShortcut(press('k', { meta: true }), 'mac')).toBe('quickFind')
    expect(matchShortcut(press('k', { ctrl: true }), 'other')).toBe('quickFind')
  })

  it('leaves Ctrl-K on a Mac and Cmd-K elsewhere alone', () => {
    expect(matchShortcut(press('k', { ctrl: true }), 'mac')).toBeNull()
    expect(matchShortcut(press('k', { meta: true }), 'other')).toBeNull()
  })

  it('never takes a combination the browser owns', () => {
    expect(matchShortcut(press('n', { meta: true }), 'mac')).toBeNull()
    expect(matchShortcut(press('r', { ctrl: true }), 'other')).toBeNull()
    expect(matchShortcut(press('n', { alt: true }), 'mac')).toBeNull()
  })

  it('maps Shift-/ to the shortcut sheet and a bare / to search', () => {
    expect(matchShortcut(press('?', { shift: true }), 'mac')).toBe('shortcuts')
    expect(matchShortcut(press('/'), 'mac')).toBe('search')
  })

  it('matches a symbol whatever Shift its layout needs', () => {
    expect(matchShortcut(press('/', { shift: true }), 'other')).toBe('search')
    expect(matchShortcut(press('?'), 'other')).toBe('shortcuts')
  })

  it('maps a capital letter typed under Caps Lock, without Shift', () => {
    expect(matchShortcut(press('N'), 'mac')).toBe('newTune')
    expect(matchShortcut(press('R'), 'other')).toBe('record')
  })

  it('stands down for a shifted letter whatever case Caps Lock gives it', () => {
    expect(matchShortcut(press('n', { shift: true }), 'other')).toBeNull()
  })

  it('maps Space and Escape', () => {
    expect(matchShortcut(press(' '), 'mac')).toBe('playPause')
    expect(matchShortcut(press('Escape'), 'mac')).toBe('stepOut')
  })

  it('leaves the go sequence to its own matcher', () => {
    expect(matchShortcut(press('g'), 'mac')).toBeNull()
    expect(matchShortcut(press('c'), 'mac')).toBeNull()
  })
})

describe('keyLabel', () => {
  it('shows the command key as ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(keyLabel('Meta', 'mac')).toBe('⌘')
    expect(keyLabel('Meta', 'other')).toBe('Ctrl')
  })

  it('names Escape and Space, and capitalizes letters', () => {
    expect(keyLabel('Escape', 'mac')).toBe('Esc')
    expect(keyLabel('Space', 'mac')).toBe('Space')
    expect(keyLabel('n', 'mac')).toBe('N')
    expect(keyLabel('?', 'mac')).toBe('?')
  })
})

describe('keySpoken', () => {
  it('speaks the command key as Command on a Mac and Control elsewhere', () => {
    expect(keySpoken('Meta', 'mac')).toBe('Command')
    expect(keySpoken('Meta', 'other')).toBe('Control')
  })

  it('speaks symbols by name, and letters as capitals', () => {
    expect(keySpoken('?', 'mac')).toBe('Question mark')
    expect(keySpoken('/', 'mac')).toBe('Slash')
    expect(keySpoken('Escape', 'mac')).toBe('Escape')
    expect(keySpoken('Space', 'mac')).toBe('Space')
    expect(keySpoken('K', 'mac')).toBe('K')
  })
})

describe('isSequence', () => {
  const shortcut = (id: string) => SHORTCUTS.find((each) => each.id === id)!

  it('holds the go keys one after another and Quick Find together', () => {
    expect(isSequence(shortcut('goLists'))).toBe(true)
    expect(isSequence(shortcut('quickFind'))).toBe(false)
    expect(isSequence(shortcut('newTune'))).toBe(false)
  })
})

describe('SHORTCUTS', () => {
  const label = (id: string) => SHORTCUTS.find((shortcut) => shortcut.id === id)?.label

  it('reuses the copy each key acts on', () => {
    expect(label('newTune')).toBe(NEW_TUNE_TITLE)
    expect(label('record')).toBe(RECORD_TEXT)
    expect(label('search')).toBe(SEARCH_TUNES)
    expect(label('shortcuts')).toBe(SHORTCUTS_TITLE)
    expect(['goCatalog', 'goLists', 'goRecordings', 'goSettings'].map(label)).toEqual(
      TABS.map((tab) => tab.label),
    )
  })

  it('lists each group together, in sheet order', () => {
    expect(SHORTCUTS.map((shortcut) => shortcut.group)).toEqual([
      ...Array<string>(6).fill('General'),
      ...Array<string>(4).fill(GO_TO),
      'Playback',
    ])
  })
})
