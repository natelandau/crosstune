import { useRecordingSettings } from '../useRecordingSettings'
import { DownloadsGroups } from './DownloadsGroups'
import { RecordingGroup } from './RecordingGroup'
import { SavedLocationsGroup } from './SavedLocationsGroup'

/** Settings > Recordings: the capture quality, the saved locations, and the audio this device keeps. */
export function RecordingsPage() {
  const audio = useRecordingSettings()
  return (
    <>
      <RecordingGroup audio={audio} />
      <SavedLocationsGroup />
      <DownloadsGroups audio={audio} />
    </>
  )
}
