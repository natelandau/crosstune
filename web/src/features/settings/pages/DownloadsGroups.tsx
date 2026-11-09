import { KEEP_OFFLINE_LABEL } from '../recordingCopy'
import {
  DOWNLOADS,
  KEEP_OFFLINE_HELP,
  REMOVE_DOWNLOADS,
  REMOVE_DOWNLOADS_HELP,
} from '../settingsCopy'
import type { RecordingSettings } from '../useRecordingSettings'
import { Group } from '../../../ui/form/Group'
import { ButtonRow } from '../../../ui/form/ButtonRow'
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
      <Group error={audio.removeError ?? undefined}>
        <ButtonRow
          title={audio.localBytesLabel}
          numeric
          description={REMOVE_DOWNLOADS_HELP}
          button={{
            label: REMOVE_DOWNLOADS,
            // While every recording is kept offline, the next pass would only fetch them again.
            isDisabled: audio.keepOffline,
            onPress: audio.removeDownloads,
          }}
        />
      </Group>
    </>
  )
}
