import { useState } from 'react'
import { CANNOT_UNDO, DELETE_ACCOUNT } from '../deleteAccountCopy'
import { ACCOUNT, ACCOUNT_OFFLINE, SIGN_OUT } from '../settingsCopy'
import { useAccountSettings } from '../useAccountSettings'
import { ButtonRow } from '../../../ui/form/ButtonRow'
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
        <ButtonRow
          title={identity?.name ?? label}
          description={identity?.name ? identity.email : undefined}
          button={{
            label: SIGN_OUT,
            variant: 'destructive',
            isDisabled: offline,
            showDone: false,
            onPress: signOut,
          }}
        />
        <ButtonRow
          title={ACCOUNT}
          description={CANNOT_UNDO}
          button={{
            label: DELETE_ACCOUNT,
            variant: 'destructive',
            isDisabled: pending || offline,
            onPress: () => setDeleting(true),
          }}
        />
      </Group>
      <UsageSharingRow />
      <DeleteAccountSheet open={deleting} onClosed={() => setDeleting(false)} />
    </>
  )
}
