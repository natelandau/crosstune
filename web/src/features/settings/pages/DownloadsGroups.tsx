import { KEEP_OFFLINE_LABEL } from '../recordingCopy'
import {
  DOWNLOADS,
  KEEP_OFFLINE_HELP,
  REMOVE_DOWNLOADS,
  REMOVE_DOWNLOADS_HELP,
} from '../settingsCopy'
import type { RecordingSettings } from '../useRecordingSettings'
import { Group } from '../../../ui/form/Group'
import { StatusRow } from '../../../ui/form/StatusRow'
import { Switch } from '../../../ui/form/Switch'

/** Whether this device downloads every recording, and the audio it holds with a way to free it. */
export function DownloadsGroups({ audio }: { audio: RecordingSettings }) {
  return (
    <>
      <Group header={DOWNLOADS} help={KEEP_OFFLINE_HELP} error={audio.keepError ?? undefined}>
        <Switch
          label={KEEP_OFFLINE_LABEL}
          isSelected={audio.keepOffline}
          onChange={audio.setKeepOffline}
        />
      </Group>
      <Group help={REMOVE_DOWNLOADS_HELP} error={audio.removeError ?? undefined}>
        <StatusRow
          title={audio.localBytesLabel}
          numeric
          action={{
            label: REMOVE_DOWNLOADS,
            // While every recording is kept offline, the next pass would only fetch them again.
            isDisabled: audio.keepOffline || audio.removePending,
            onPress: audio.removeDownloads,
          }}
        />
      </Group>
    </>
  )
}
