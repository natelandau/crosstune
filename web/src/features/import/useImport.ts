import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { countBucket } from '../../usage/buckets'
import type { ImportEntry } from '../../usage/events'
import type { TuneStatus } from '../../api/vocabulary'
import { importTunes, type ImportListChoice } from '../../commands/importTunes'
import { useDb } from '../../db/DbProvider'
import { storedNewTuneGenre, storedNewTuneStatus } from '../../db/types'
import { useToast } from '../../ui/Toast'
import { useAction } from '../../ui/useAction'
import { useEndOnClose } from '../../ui/useEndOnClose'
import { useCatalog } from '../catalog/useCatalog'
import { useActiveLists } from '../lists/useLists'
import { useSettingsRow } from '../settings/useSettingsRow'
import { addedTunesToast, importListName, TEXT_FILES_ONLY } from './importCopy'
import { readPlainList } from './plainList'
import { readTextFile } from './readTextFile'
import {
  buildReview,
  foldedCatalogTitles,
  isDuplicate,
  markDuplicates,
  suggestsHelp,
  type ImportRow,
} from './review'

export type ImportStep = 'paste' | 'review'

/** The list choice's picker value: null adds to no list, `NEW_LIST` to a new one, else a list id. */
export type ImportListKey = string | null

// No list id can be it: ids are UUIDs, which never hold a NUL.
export const NEW_LIST = '\u0000new'

export interface ImportSession {
  step: ImportStep
  text: string
  setText: (text: string) => void
  /**
   * Reads a picked or dropped text file into the field, replacing what is there. Any other file
   * is refused with an error.
   */
  openFiles: (files: File[]) => void
  /** True once there is text to lose, so the sheet refuses a dismissal that would lose it. */
  typed: boolean
  canContinue: boolean
  review: () => void
  back: () => void
  rows: ImportRow[]
  dropped: number
  showsHelp: boolean
  setTitle: (key: string, title: string) => void
  setIncluded: (key: string, included: boolean) => void
  status: TuneStatus
  setStatus: (status: TuneStatus) => void
  genre: string
  setGenre: (genre: string) => void
  listKey: ImportListKey
  setListKey: (key: ImportListKey) => void
  lists: { id: string; name: string }[]
  listName: string
  setListName: (name: string) => void
  /** The rows Add would create: checked, with a title. */
  count: number
  canAdd: boolean
  add: () => void
  error: string | null
  pending: boolean
  closing: boolean
  close: () => void
}

// By name, not type: a browser types many files, a .log among them, as text/plain.
const isTextFile = (file: File) => /\.txt$/i.test(file.name)

const adds = (row: ImportRow) => row.included && row.title.trim() !== ''

/**
 * One import, from the pasted or opened text through the review to the write. Opening starts
 * a fresh import; Add writes every checked row with a title in one transaction and closes.
 */
export function useImport(open: boolean, entry: ImportEntry): ImportSession {
  const db = useDb()
  const analytics = useAnalytics()
  const toast = useToast()
  const { error, pending, runThen, clear } = useAction()
  const fileAction = useAction()
  const [closing, setClosing] = useState(false)
  const active = open && !closing
  const catalog = useCatalog(active)
  const settings = useSettingsRow(active)
  const activeLists = useActiveLists()

  const [openedFor, setOpenedFor] = useState(false)
  const [step, setStep] = useState<ImportStep>('paste')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  // The text the rows were read from, so Continue on the same text keeps the musician's edits.
  const [reviewedText, setReviewedText] = useState<string | null>(null)
  // The catalog the duplicate notes were checked against. A tune added since, as by a sync or
  // while the musician looked back at the paste, marks its row on the review.
  const [checkedAgainst, setCheckedAgainst] = useState<typeof catalog>(undefined)
  const [dropped, setDropped] = useState(0)
  const [showsHelp, setShowsHelp] = useState(false)
  // Null follows the new-tune settings until the musician picks for this batch.
  const [statusChoice, setStatusChoice] = useState<TuneStatus | null>(null)
  const [genreChoice, setGenreChoice] = useState<string | null>(null)
  const [listKey, setListKey] = useState<ImportListKey>(null)
  const [listName, setListName] = useState('')

  if (open !== openedFor) {
    setOpenedFor(open)
    if (open) {
      setClosing(false)
      setStep('paste')
      setText('')
      setRows([])
      setReviewedText(null)
      setDropped(0)
      setShowsHelp(false)
      setStatusChoice(null)
      setGenreChoice(null)
      setListKey(null)
      setListName(importListName(new Date()))
      clear()
      fileAction.clear()
    }
  }

  const catalogTitles = useMemo(() => catalog && foldedCatalogTitles(catalog), [catalog])

  // Not while Add writes or the sheet closes: the tunes just added would mark every row.
  if (step === 'review' && !pending && !closing && catalog && catalog !== checkedAgainst) {
    setCheckedAgainst(catalog)
    setRows((current) => markDuplicates(current, catalog))
  }

  // Reported once per opening.
  const reported = useRef(false)
  useEffect(() => {
    if (!open) reported.current = false
    else if (!reported.current) {
      reported.current = true
      analytics.send('import_started', { entry })
    }
  }, [open, entry, analytics])

  // The closing sheet keeps its last content, so the pasted text and rows can go now.
  useEndOnClose(closing, () => {
    setText('')
    setRows([])
    setReviewedText(null)
  })

  // Add takes only a press that starts once the review shows. The primary keeps its place as
  // Continue becomes Add, so the second click of a double click would land on Add.
  const addArmed = useRef(false)
  useLayoutEffect(() => {
    if (step !== 'review') return
    addArmed.current = false
    const arm = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? !event.repeat : event.detail <= 1)
        addArmed.current = true
    }
    document.addEventListener('click', arm, true)
    document.addEventListener('keydown', arm, true)
    return () => {
      document.removeEventListener('click', arm, true)
      document.removeEventListener('keydown', arm, true)
    }
  }, [step])

  const status = statusChoice ?? storedNewTuneStatus(settings)
  const genre = genreChoice ?? storedNewTuneGenre(settings)?.trim() ?? ''
  const count = rows.filter(adds).length
  const typed = text.trim() !== ''

  const review = () => {
    if (!catalog || settings === undefined || !typed) return
    clear()
    fileAction.clear()
    if (text === reviewedText) {
      setStep('review')
      return
    }
    const built = buildReview(readPlainList(text), catalog)
    setRows(built.rows)
    setCheckedAgainst(catalog)
    setReviewedText(text)
    setDropped(built.dropped)
    // A paste that gave no rows was not read as meant, so the help is worth showing too.
    setShowsHelp(built.rows.length === 0 || suggestsHelp(built))
    setStep('review')
    analytics.send('import_reviewed', {
      reader: 'plain',
      count_bucket: countBucket(built.rows.length),
      duplicate_bucket: countBucket(built.rows.filter((row) => row.duplicate).length),
      has_warnings: built.rows.some((row) => row.warnings.length > 0),
    })
  }

  const listChoice = (): ImportListChoice => {
    if (listKey === null) return { kind: 'none' }
    if (listKey === NEW_LIST) return { kind: 'new', name: listName.trim() }
    return { kind: 'existing', listId: listKey }
  }

  const canAdd =
    count > 0 && !pending && !closing && (listKey !== NEW_LIST || listName.trim() !== '')

  const add = () => {
    if (!canAdd || !addArmed.current) return
    const titles = rows.filter(adds).map((row) => row.title.trim())
    const list = listChoice()
    const skipped = rows.length - titles.length
    runThen(
      async () => {
        const result = await importTunes(db, {
          titles,
          status,
          genre: genre.trim() || null,
          list,
        })
        const added = countBucket(result.userTuneIds.length)
        if (result.listId && result.listCreated) {
          analytics.send('list_created', { list_id: result.listId, count_bucket: added })
        } else if (result.listId) {
          analytics.send('tunes_added_to_list', { list_id: result.listId, count_bucket: added })
        }
        analytics.send('import_completed', {
          reader: 'plain',
          count_bucket: added,
          skipped_bucket: countBucket(skipped),
          list: list.kind,
        })
      },
      () => {
        toast.show(addedTunesToast(titles.length))
        setClosing(true)
      },
    )
  }

  const openFiles = (files: File[]) => {
    const file = files.find(isTextFile)
    fileAction.run(async () => {
      if (!file) throw new Error(TEXT_FILES_ONLY)
      setText(await readTextFile(file))
    })
  }

  return {
    step,
    text,
    // New text is the musician's answer to a refused or unreadable file.
    setText: (next) => {
      setText(next)
      fileAction.clear()
    },
    openFiles,
    typed,
    // A file still being read would replace the text behind the review.
    canContinue: typed && catalog !== undefined && settings !== undefined && !fileAction.pending,
    review,
    back: () => {
      if (pending) return
      setStep('paste')
      clear()
    },
    rows,
    dropped,
    showsHelp,
    setTitle: (key, title) =>
      setRows((current) =>
        current.map((row) =>
          row.key === key
            ? {
                ...row,
                title,
                duplicate: catalogTitles ? isDuplicate(title, catalogTitles) : row.duplicate,
                // An edit replaces the cut title, so it no longer says what was read.
                warnings: [],
              }
            : row,
        ),
      ),
    setIncluded: (key, included) =>
      setRows((current) => current.map((row) => (row.key === key ? { ...row, included } : row))),
    status,
    setStatus: setStatusChoice,
    genre,
    setGenre: setGenreChoice,
    listKey,
    setListKey,
    lists: (activeLists ?? []).map((list) => ({ id: list.id, name: list.name })),
    listName,
    setListName,
    count,
    canAdd,
    add,
    error: error ?? fileAction.error,
    pending,
    closing,
    close: () => {
      if (!pending) setClosing(true)
    },
  }
}
