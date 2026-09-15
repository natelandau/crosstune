import { UploadRecordingInput } from '../recording/UploadRecordingInput'
import { RecordingList } from './RecordingList'
import { StorageMeter } from './StorageMeter'
import { useRecordingsWithFiles } from './useRecordings'

export function RecordingsScreen() {
  const views = useRecordingsWithFiles()
  if (views === undefined) return null
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Recordings</h1>
      <StorageMeter />
      <RecordingList views={views} showSong />
      <UploadRecordingInput songId={null} />
    </div>
  )
}
