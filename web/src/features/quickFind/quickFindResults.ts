import { containsText, foldText } from '../../text/fold'
import { tabLabel } from '../../app/tabs'
import { GO_TO, type ShortcutId } from '../../ui/keymap'
import type { HeardEntry } from '../catalog/filters'
import { matchTunes, MAX_RESULTS } from '../catalog/tuneMatches'
import { recordingLabel, recordingMatches } from '../recordings/recordingMatch'
import { recordingTitle } from '../recordings/recordingRow'
import type { RecordingView } from '../recordings/useRecordings'
import { compareNames } from '../../text/collate'

export const QUICK_FIND_PLACEHOLDER = 'Find tunes, lists, and recordings'
export const NO_MATCHES = 'No matches'

/** A Go to command's label, such as Go to Lists. */
export const goToLabel = (place: string) => `${GO_TO} ${place}`

export type QuickFindSectionId = 'commands' | 'tunes' | 'lists' | 'recordings'

/** Each section's heading, in the order Quick Find shows them. */
export const QUICK_FIND_SECTIONS: Record<QuickFindSectionId, string> = {
  commands: 'Commands',
  tunes: 'Tunes',
  lists: tabLabel('lists'),
  recordings: tabLabel('recordings'),
}

/** A command's second step: choices Quick Find shows in place of its results. */
export interface QuickFindStep {
  title: string
  choices: QuickFindCommand[]
}

interface CommandBase {
  id: string
  label: string
  /** A second line, such as the direction of the current sort. */
  description?: string
  /** The keymap shortcut that runs the same command, whose keys the row shows. */
  shortcut?: ShortcutId
}

/** Something the app already does, which Quick Find runs and then closes, or a second step. */
export type QuickFindCommand =
  | (CommandBase & { run: () => void; step?: never })
  | (CommandBase & { step: QuickFindStep; run?: never })

interface ItemBase {
  /** Unique across every section. */
  key: string
  title: string
}

export type QuickFindItem =
  | (ItemBase & { kind: 'command'; command: QuickFindCommand })
  | (ItemBase & { kind: 'tune'; tuneId: string; archived: boolean })
  | (ItemBase & { kind: 'list'; listId: string })
  | (ItemBase & {
      kind: 'recording'
      recordingId: string
      /** Null for an unfiled recording. */
      tuneId: string | null
      tuneTitle: string | null
    })

export interface QuickFindSection {
  id: QuickFindSectionId
  /** Stands in for the section's heading, such as a second step's title. */
  title?: string
  items: QuickFindItem[]
}

export interface QuickFindList {
  id: string
  name: string
}

export interface QuickFindSources {
  query: string
  tunes: readonly HeardEntry[]
  lists: readonly QuickFindList[]
  recordings: readonly RecordingView[]
  commands: readonly QuickFindCommand[]
}

const isWordCharacter = (character: string) => /[\p{L}\p{N}]/u.test(character)

/** 0 when a text starts with the needle, 1 when one of its words does, else 2. */
function rankOf(texts: readonly string[], needle: string): number {
  const folded = foldText(needle)
  let best = 2
  for (const text of texts) {
    const haystack = foldText(text)
    if (haystack.startsWith(folded)) return 0
    for (let at = haystack.indexOf(folded); at > 0; at = haystack.indexOf(folded, at + 1)) {
      if (!isWordCharacter(haystack[at - 1]!)) {
        best = 1
        break
      }
    }
  }
  return best
}

/** Best match first, keeping the given order among equal ranks. */
function ranked<T>(items: readonly T[], texts: (item: T) => string[], needle: string): T[] {
  return items
    .map((item, index) => ({ item, index, rank: rankOf(texts(item), needle) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)
}

export function commandItem(command: QuickFindCommand): QuickFindItem {
  return { kind: 'command', key: `command:${command.id}`, title: command.label, command }
}

/** The commands a query finds, best first; every command for a blank query. */
export function findCommands(
  commands: readonly QuickFindCommand[],
  query: string,
): QuickFindItem[] {
  const needle = query.trim()
  const found = needle
    ? ranked(
        commands.filter((command) => containsText(command.label, needle)),
        (command) => [command.label],
        needle,
      )
    : commands
  return found.map(commandItem)
}

/**
 * What Quick Find shows for a query, in sections ordered commands, tunes, lists, recordings,
 * each best match first. A blank query shows the commands alone. Each found section holds at
 * most `MAX_RESULTS`; the commands are a short fixed set and all show.
 */
export function rankResults({ query, tunes, lists, recordings, commands }: QuickFindSources): {
  sections: QuickFindSection[]
} {
  const needle = query.trim()
  const sections: QuickFindSection[] = [{ id: 'commands', items: findCommands(commands, needle) }]
  if (needle) {
    const foundTunes = ranked(
      matchTunes([...tunes], needle),
      ({ tune }) => [tune.title, ...tune.alternate_titles],
      needle,
    )
    const foundLists = ranked(
      lists.filter((list) => containsText(list.name, needle)),
      (list) => [list.name],
      needle,
    )
    const foundRecordings = ranked(
      recordings
        .filter((view) => recordingMatches(view, needle))
        .sort((a, b) => compareNames(recordingTitle(a), recordingTitle(b))),
      (view) => [recordingLabel(view), view.tuneTitle ?? ''],
      needle,
    )
    sections.push(
      {
        id: 'tunes',
        items: foundTunes.slice(0, MAX_RESULTS).map(({ tune, userTune }) => ({
          kind: 'tune',
          key: `tune:${tune.id}`,
          title: tune.title,
          tuneId: tune.id,
          archived: userTune.archived_at != null,
        })),
      },
      {
        id: 'lists',
        items: foundLists.slice(0, MAX_RESULTS).map((list) => ({
          kind: 'list',
          key: `list:${list.id}`,
          title: list.name,
          listId: list.id,
        })),
      },
      {
        id: 'recordings',
        items: foundRecordings.slice(0, MAX_RESULTS).map((view) => ({
          kind: 'recording',
          key: `recording:${view.recording.id}`,
          title: recordingTitle(view),
          recordingId: view.recording.id,
          tuneId: view.tuneId,
          tuneTitle: view.tuneTitle,
        })),
      },
    )
  }
  return { sections: sections.filter((section) => section.items.length > 0) }
}
