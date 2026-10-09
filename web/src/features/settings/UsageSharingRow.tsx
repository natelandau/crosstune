import { useState } from 'react'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { isSharingUsage, setSharingUsage } from '../../analytics/usageSharing'
import { Group } from '../../ui/form/Group'
import { Switch } from '../../ui/form/Switch'
import { USAGE_DATA_FOOTER, USAGE_DATA_TITLE } from './settingsCopy'

/** The per-device choice to report which features are used. On unless turned off here. */
export function UsageSharingRow() {
  const analytics = useAnalytics()
  const [sharing, setSharing] = useState(() => isSharingUsage())
  const change = (next: boolean) => {
    setSharing(next)
    const done = next ? analytics.enableSharing() : analytics.disableSharing()
    // A build with no analytics key still remembers the choice.
    void done.then(() => setSharingUsage(next))
  }
  return (
    <Group footer={USAGE_DATA_FOOTER}>
      <Switch label={USAGE_DATA_TITLE} isSelected={sharing} onChange={change} />
    </Group>
  )
}
