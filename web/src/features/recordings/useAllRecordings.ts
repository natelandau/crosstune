import { createSharedLiveQuery } from '../../db/sharedLiveQuery'

/**
 * Every recording row, deleted ones included; undefined until read. The editors that each need
 * the whole table share one read of it.
 */
export const useAllRecordings = createSharedLiveQuery((db) => db.recordings.toArray())
