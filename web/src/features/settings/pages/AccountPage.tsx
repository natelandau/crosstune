import { useState } from 'react'
import { DELETE_ACCOUNT } from '../deleteAccountCopy'
import { EXPORT_DATA } from '../export/exportCopy'
import { ACCOUNT_OFFLINE, SIGN_OUT } from '../settingsCopy'
import { useAccountSettings } from '../useAccountSettings'
import { ActionRow } from '../../../ui/form/ActionRow'
import { Group } from '../../../ui/form/Group'
import { DeleteAccountSheet } from './DeleteAccountSheet'
import { ExportSheet } from './ExportSheet'

/** Who is signed in, and the way out. */
export function AccountPage() {
  const { identity, label, offline, error, pending, signOut } = useAccountSettings()
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <Group error={error ?? undefined} footer={offline ? ACCOUNT_OFFLINE : undefined}>
        <div className="flex min-h-(--target) flex-col justify-center px-4 py-2">
          <span className="t-body truncate">{identity?.name ?? label}</span>
          {identity?.name && identity.email && (
            <span className="t-secondary text-ink-2 truncate">{identity.email}</span>
          )}
        </div>
        <ActionRow label={SIGN_OUT} destructive isDisabled={pending || offline} onPress={signOut} />
        {/* Reads only the local store, so it needs no connection. */}
        <ActionRow label={EXPORT_DATA} isDisabled={pending} onPress={() => setExporting(true)} />
        <ActionRow
          label={DELETE_ACCOUNT}
          destructive
          isDisabled={pending || offline}
          onPress={() => setDeleting(true)}
        />
      </Group>
      <ExportSheet open={exporting} onClosed={() => setExporting(false)} />
      <DeleteAccountSheet open={deleting} onClosed={() => setDeleting(false)} />
    </>
  )
}
