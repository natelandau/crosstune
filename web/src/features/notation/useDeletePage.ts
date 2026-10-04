import { deleteNotationPage } from '../../commands/notation'
import { useDb } from '../../db/DbProvider'
import type { NotationFile } from '../../db/notation'
import type { LocalNotationPage } from '../../db/types'
import { DELETE, useConfirm } from '../../ui/Confirm'
import { useAction } from '../../ui/useAction'
import { DELETE_SYNCED_NOTE, DELETE_UNSYNCED_NOTE } from '../recordings/recordingRow'
import { DELETE_PAGE_TITLE } from './notationCopy'

/** Deletes a page once the musician confirms, saying first whether it can come back. */
export function useDeletePage() {
  const db = useDb()
  const confirm = useConfirm()
  const { error, run, clear } = useAction()

  const remove = async (page: LocalNotationPage, file: NotationFile | undefined) => {
    // A captured file is the only copy until it uploads.
    const unsynced = file?.origin === 'captured'
    const ok = await confirm({
      title: DELETE_PAGE_TITLE,
      message: unsynced ? DELETE_UNSYNCED_NOTE : DELETE_SYNCED_NOTE,
      action: DELETE,
    })
    if (ok) run(() => deleteNotationPage(db, page.id))
  }

  return {
    error,
    clear,
    remove: (page: LocalNotationPage, file: NotationFile | undefined) => void remove(page, file),
  }
}
