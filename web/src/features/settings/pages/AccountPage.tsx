import { useState } from 'react'
import { DELETE_ACCOUNT } from '../deleteAccountCopy'
import { ACCOUNT_OFFLINE, SIGN_OUT } from '../settingsCopy'
import { useAccountSettings } from '../useAccountSettings'
import { ActionRow } from '../../../ui/form/ActionRow'
import { Group } from '../../../ui/form/Group'
import { PlanGroup } from '../PlanGroup'
import { UsageSharingRow } from '../UsageSharingRow'
import { DeleteAccountSheet } from './DeleteAccountSheet'

/** Who is signed in, the way out, and whether this device shares usage data. */
export function AccountPage() {
  const { identity, label, offline, error, pending, signOut } = useAccountSettings()
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <PlanGroup />
      <Group error={error ?? undefined} footer={offline ? ACCOUNT_OFFLINE : undefined}>
        <div className="flex min-h-(--target) flex-col justify-center px-4 py-2">
          <span className="t-body truncate">{identity?.name ?? label}</span>
          {identity?.name && identity.email && (
            <span className="t-secondary text-ink-2 truncate">{identity.email}</span>
          )}
        </div>
        <ActionRow label={SIGN_OUT} destructive isDisabled={pending || offline} onPress={signOut} />
        <ActionRow
          label={DELETE_ACCOUNT}
          destructive
          isDisabled={pending || offline}
          onPress={() => setDeleting(true)}
        />
      </Group>
      <UsageSharingRow />
      <DeleteAccountSheet open={deleting} onClosed={() => setDeleting(false)} />
    </>
  )
}
