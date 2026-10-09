import { LAST_SYNCED, lastSyncedLabel } from '../lastSynced'
import { KEEP_OFFLINE_LABEL } from '../recordingCopy'
import {
  KEEP_OFFLINE_HELP,
  REMOVE_DOWNLOADS,
  REMOVE_DOWNLOADS_HELP,
  SYNC,
  SYNC_NOW,
  SYNC_STATUS_LABEL,
  TRANSFERS_LABEL,
} from '../settingsCopy'
import { useRecordingSettings } from '../useRecordingSettings'
import { useSyncSettings } from '../useSyncSettings'
import { StorageSummary } from '../../recordings/StorageSummary'
import { ActionRow } from '../../../ui/form/ActionRow'
import { FieldRow } from '../../../ui/form/FieldRow'
import { Group } from '../../../ui/form/Group'
import { Switch } from '../../../ui/form/Switch'
import { useNow } from '../../../ui/useNow'

/**
 * The full sync state, including the clean and running states the sync badge leaves out, then
 * the account's storage and the audio this device keeps.
 */
export function SyncPage() {
  const sync = useSyncSettings()
  const audio = useRecordingSettings()
  const now = useNow()
  return (
    <>
      <Group header={SYNC} error={sync.error ?? undefined}>
        <FieldRow label={SYNC_STATUS_LABEL} value={sync.statusLabel} />
        <FieldRow label={TRANSFERS_LABEL} value={sync.transferLabel} />
        <FieldRow label={LAST_SYNCED} value={lastSyncedLabel(sync.lastSynced, now)} />
        {sync.rejectedMessage && (
          <p role="status" className="t-secondary px-4 py-2">
            {sync.rejectedMessage}
          </p>
        )}
        <ActionRow label={SYNC_NOW} isDisabled={sync.pending} onPress={sync.syncNow} />
      </Group>
      <StorageSummary />
      <Group help={KEEP_OFFLINE_HELP} error={audio.keepError ?? undefined}>
        <Switch
          label={KEEP_OFFLINE_LABEL}
          isSelected={audio.keepOffline}
          onChange={audio.setKeepOffline}
        />
      </Group>
      <Group help={REMOVE_DOWNLOADS_HELP} error={audio.removeError ?? undefined}>
        <p className="t-body t-num flex min-h-(--target) items-center px-4">
          {audio.localBytesLabel}
        </p>
        <ActionRow
          label={REMOVE_DOWNLOADS}
          isDisabled={audio.keepOffline || audio.removePending}
          onPress={audio.removeDownloads}
        />
      </Group>
    </>
  )
}
