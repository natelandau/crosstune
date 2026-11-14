import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { countLiveRecordings } from '../../db/recordings'
import { readRecordingView, type RecordingView } from '../recordings/useRecordings'

// These sit above every error boundary, so a failed read answers as none or gone, never throws.

/**
 * How many recordings the account keeps, live while `active`; undefined until read and while
 * inactive, 0 when the read failed.
 */
export function useRecordingCount(active: boolean): number | undefined {
  const db = useDb()
  return useLiveQuery<number | undefined>(
    () => (active ? countLiveRecordings(db).catch(() => 0) : undefined),
    [db, active],
  )
}

/** Recording `id` with its local file, live; null once gone or with no id, undefined until read. */
export function useLiveRecordingView(id: string | null): RecordingView | null | undefined {
  const db = useDb()
  // With no id the query reads no table, so it observes nothing.
  const read = useLiveQuery(
    async () =>
      id === null ? undefined : { id, view: await readRecordingView(db, id).catch(() => null) },
    [db, id],
  )
  if (id === null) return null
  // A live query keeps its last answer while a new id reads, so an answer for another id is unread.
  return read?.id === id ? read.view : undefined
}
