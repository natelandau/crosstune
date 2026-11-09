import { CircleAlert, CircleCheck, CloudOff, RefreshCw, type LucideIcon } from 'lucide-react'
import type { SyncStatus } from '../../../sync/types'
import { lastSyncedLine } from '../lastSynced'
import { SYNC, SYNC_NOW, TRANSFERS_LABEL } from '../settingsCopy'
import { useSyncSettings } from '../useSyncSettings'
import { StorageSummary } from '../../recordings/StorageSummary'
import { FieldRow } from '../../../ui/form/FieldRow'
import { Group } from '../../../ui/form/Group'
import { ButtonRow } from '../../../ui/form/ButtonRow'
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
 * the account's storage.
 */
export function SyncPage() {
  const sync = useSyncSettings()
  const now = useNow()
  // A sync this button started shows its own working state; one started elsewhere holds it off.
  const syncingElsewhere = sync.status === 'syncing' && !sync.pending
  return (
    <>
      <Group header={SYNC} error={sync.error ?? undefined}>
        <ButtonRow
          icon={<SyncGlyph status={sync.status} />}
          title={sync.statusLabel}
          description={lastSyncedLine(sync.lastSynced, now)}
          button={{
            label: SYNC_NOW,
            icon: RefreshCw,
            isDisabled: syncingElsewhere,
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
    </>
  )
}

/** The sync state's glyph: quiet while all is well, red once a sync has failed. */
function SyncGlyph({ status }: { status: SyncStatus }) {
  const Icon = STATUS_ICONS[status]
  const tone = status === 'error' ? 'text-danger' : 'text-secondary'
  return <Icon className={`size-5 shrink-0 ${tone}`} aria-hidden />
}
