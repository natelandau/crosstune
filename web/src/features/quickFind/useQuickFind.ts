import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { activeByPosition } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import { useCatalog } from '../catalog/useCatalog'
import { readRecordingsWithFiles } from '../recordings/useRecordings'
import {
  findCommands,
  rankResults,
  type QuickFindCommand,
  type QuickFindItem,
  type QuickFindSection,
  type QuickFindStep,
} from './quickFindResults'

export interface QuickFind {
  query: string
  setQuery: (query: string) => void
  sections: QuickFindSection[]
  /** Whether the catalog, lists, and recordings have been read, so no match means none. */
  ready: boolean
  /** The open second step's title, or null on the first. */
  step: string | null
  /** Opens a command's second step in place, or hands any other item to `onChoose`. */
  run: (item: QuickFindItem) => void
  /** Back from a second step to the first, with the query it left. */
  leaveStep: () => void
}

/**
 * Quick Find's query and results. The catalog, lists, and recordings are read only while
 * `open`, and each opening starts from an empty query on the first step.
 */
export function useQuickFind(
  open: boolean,
  {
    commands,
    onChoose,
  }: {
    commands: readonly QuickFindCommand[]
    /** A chosen item: a tune, list, or recording to open, or a command to run. */
    onChoose: (item: QuickFindItem) => void
  },
): QuickFind {
  const db = useDb()
  const tunes = useCatalog(open)
  const lists = useLiveQuery(
    async () => (open ? activeByPosition(await db.lists.toArray()) : undefined),
    [db, open],
  )
  const recordings = useLiveQuery(
    async () => (open ? readRecordingsWithFiles(db) : undefined),
    [db, open],
  )
  const [query, setQuery] = useState('')
  const [step, setStep] = useState<QuickFindStep | null>(null)
  const [queryBeforeStep, setQueryBeforeStep] = useState('')

  // Reset while rendering, not in an effect, so an opening never shows the last query.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setStep(null)
    }
  }

  const ready = tunes !== undefined && lists !== undefined && recordings !== undefined
  const sections = useMemo<QuickFindSection[]>(() => {
    if (step) {
      const items = findCommands(step.choices, query)
      return items.length > 0 ? [{ id: 'commands', title: step.title, items }] : []
    }
    return rankResults({
      query,
      tunes: tunes ?? [],
      lists: lists ?? [],
      recordings: recordings ?? [],
      commands: open ? commands : [],
    }).sections
  }, [step, query, tunes, lists, recordings, commands, open])

  const run = (item: QuickFindItem) => {
    if (item.kind === 'command' && item.command.step) {
      setStep(item.command.step)
      setQueryBeforeStep(query)
      setQuery('')
      return
    }
    onChoose(item)
  }

  const leaveStep = () => {
    setStep(null)
    setQuery(queryBeforeStep)
  }

  return { query, setQuery, sections, ready, step: step?.title ?? null, run, leaveStep }
}
