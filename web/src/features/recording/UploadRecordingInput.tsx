import { useLiveQuery } from 'dexie-react-hooks'
import { addUploadedFile } from '../../commands/recordings'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { formatBytes } from './format'

export function UploadRecordingInput({ songId }: { songId: string | null }) {
  const db = useDb()
  const figures = useLiveQuery(() => getStorage(db), [db])
  const { error, run } = useAction()
  return (
    <div className="space-y-1">
      {/* The native picker button cannot be relabeled, so the input hides behind a styled label. */}
      <label className="btn min-h-11">
        Upload audio file
        <input
          type="file"
          accept="audio/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            run(async () => {
              // The server refuses all three of these permanently; storing them would
              // only leave a row stuck waiting on an upload that can never succeed.
              if (!file.type.startsWith('audio/')) throw new Error('Choose an audio file.')
              if (file.size === 0) throw new Error('This file is empty.')
              if (figures && file.size > figures.max_file_bytes) {
                throw new Error(`Files are limited to ${formatBytes(figures.max_file_bytes)}.`)
              }
              await addUploadedFile(db, file, { songId, label: file.name.replace(/\.[^.]+$/, '') })
            })
          }}
        />
      </label>
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
