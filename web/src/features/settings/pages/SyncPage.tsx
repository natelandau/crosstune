import { CircleAlert, CircleCheck, CloudOff, RefreshCw, type LucideIcon } from 'lucide-react'
import type { SyncStatus } from '../../../sync/types'
import { lastSyncedLine } from '../lastSynced'
import { KEEP_OFFLINE_LABEL } from '../recordingCopy'
import {
  KEEP_OFFLINE_HELP,
  REMOVE_DOWNLOADS,
  REMOVE_DOWNLOADS_HELP,
  SYNC,
  SYNC_NOW,
  TRANSFERS_LABEL,
} from '../settingsCopy'
import { useRecordingSettings } from '../useRecordingSettings'
import { useSyncSettings } from '../useSyncSettings'
import { StorageSummary } from '../../recordings/StorageSummary'
import { FieldRow } from '../../../ui/form/FieldRow'
import { Group } from '../../../ui/form/Group'
import { StatusRow } from '../../../ui/form/StatusRow'
import { Switch } from '../../../ui/form/Switch'
import { useNow } from '../../../ui/useNow'

const STATUS_ICONS: Record<SyncStatus, LucideIcon> = {
  idle: CircleCheck,
  syncing: RefreshCw,
  offline: CloudOff,
  unauthorized: CircleAlert,
  error: CircleAlert,
}

/**
 * The full sync state, including the clean and running states the sync badge leaves out, then
 * the account's storage and the audio this device keeps.
 */
export function SyncPage() {
  const sync = useSyncSettings()
  const audio = useRecordingSettings()
  const now = useNow()
  const syncing = sync.pending || sync.status === 'syncing'
  return (
    <>
      <Group header={SYNC} error={sync.error ?? undefined}>
        <StatusRow
          icon={<SyncGlyph status={sync.status} />}
          title={sync.statusLabel}
          detail={lastSyncedLine(sync.lastSynced, now)}
          action={{
            label: SYNC_NOW,
            glyph: (
              <RefreshCw
                className={`size-5 shrink-0 ${syncing ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden
              />
            ),
            isDisabled: syncing,
            onPress: sync.syncNow,
          }}
        />
        {sync.rejectedMessage && (
          <p role="status" className="t-secondary px-4 py-2">
            {sync.rejectedMessage}
          </p>
        )}
        <FieldRow label={TRANSFERS_LABEL} value={sync.transferLabel} />
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
        <StatusRow
          title={audio.localBytesLabel}
          numeric
          action={{
            label: REMOVE_DOWNLOADS,
            isDisabled: audio.keepOffline || audio.removePending,
            onPress: audio.removeDownloads,
          }}
        />
      </Group>
    </>
  )
}

/** The sync state's glyph: quiet while all is well, red once a sync has failed. */
function SyncGlyph({ status }: { status: SyncStatus }) {
  const Icon = STATUS_ICONS[status]
  const tone = status === 'error' ? 'text-danger' : 'text-ink-2'
  return <Icon className={`size-5 shrink-0 ${tone}`} aria-hidden />
}
