import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { sortPages, type NotationFile } from '../../db/notation'
import type { LocalNotationPage } from '../../db/types'

export interface NotationPages {
  /** The tune's live pages in reading order. */
  pages: LocalNotationPage[]
  /** The image this device holds for each page, by page id; a page not yet downloaded has none. */
  files: Map<string, NotationFile>
}

/** A tune's pages and their local images, or undefined until the first read lands. */
export function useNotationPages(tuneId: string): NotationPages | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const rows = await db.notation_pages.where('tune_id').equals(tuneId).toArray()
    const pages = sortPages(rows.filter((row) => !row.deleted_at))
    const files = await db.notation_files.bulkGet(pages.map((page) => page.id))
    return {
      pages,
      files: new Map(files.filter((file) => file !== undefined).map((file) => [file.id, file])),
    }
  }, [db, tuneId])
}

const NO_TUNES: ReadonlySet<string> = new Set()

/** The ids of every tune with a live page, read once for a whole screen of tune rows. */
export function useNotationTuneIds(): ReadonlySet<string> {
  const db = useDb()
  return (
    useLiveQuery(async () => {
      const rows = await db.notation_pages.filter((row) => !row.deleted_at).toArray()
      return new Set(rows.map((row) => row.tune_id))
    }, [db]) ?? NO_TUNES
  )
}
