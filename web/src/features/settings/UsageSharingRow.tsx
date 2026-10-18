import { useState, useSyncExternalStore } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { setSharingUsage, storedSharingChoice } from '../../usage/usageSharing'
import { Group } from '../../ui/form/Group'
import { Switch } from '../../ui/form/Switch'
import { USAGE_DATA_HELP, USAGE_DATA_TITLE } from './settingsCopy'

/** The per-device choice to report which features are used. Off until the region's default or the person turns it on. */
export function UsageSharingRow() {
  const analytics = useAnalytics()
  // The regional default can land at any time, the first render included.
  const live = useSyncExternalStore(analytics.subscribeSharing, analytics.isSharing)
  // A build with no analytics key never shares, so the row shows the stored choice instead.
  const [chosen, setChosen] = useState(() => storedSharingChoice() === true)
  const sharing = live || chosen
  const change = (next: boolean) => {
    setChosen(next)
    const done = next ? analytics.enableSharing() : analytics.disableSharing()
    // A build with no analytics key still remembers the choice.
    void done.then(() => setSharingUsage(next))
  }
  return (
    <Group help={USAGE_DATA_HELP}>
      <Switch label={USAGE_DATA_TITLE} isSelected={sharing} onChange={change} />
    </Group>
  )
}
