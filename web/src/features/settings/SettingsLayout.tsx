import { Settings } from 'lucide-react'
import { useMatch, useOutlet, useParams } from 'react-router'
import { SETTINGS_STATS_PATH } from './settingsPaths'
import { STATS_TITLE } from '../stats/copy'
import { destination } from '../../app/destinations'
import { Columns } from '../../app/Columns'
import { TUNE } from '../tune/tunePageCopy'
import { EmptyState } from '../../ui/EmptyState'
import { SettingsPage } from './SettingsPage'
import { isSettingsPage, settingsPageSpec } from './settingsPages'
import { SettingsRoot } from './SettingsRoot'

export const NO_SETTING_SELECTED = 'No setting selected'

const SETTINGS = destination('settings')

/**
 * The categories in the content column, and the open page as the detail: a settings page, the
 * stats, or a tune opened from the stats.
 */
export function SettingsLayout() {
  const { page, tuneId } = useParams()
  const outlet = useOutlet()
  const stats = useMatch(`${SETTINGS_STATS_PATH}/*`) !== null
  const spec = isSettingsPage(page) ? settingsPageSpec(page) : null
  // The root and a settings page route to no element of their own, so only the stats routes
  // fill the detail from the outlet.
  const detail = spec ? <SettingsPage key={spec.id} spec={spec} /> : stats ? outlet : null
  const detailLabel = spec?.title ?? (tuneId ? TUNE : stats ? STATS_TITLE : SETTINGS.label)
  return (
    <Columns
      list={<SettingsRoot />}
      listLabel={SETTINGS.label}
      detail={detail}
      detailLabel={detailLabel}
      empty={<EmptyState icon={Settings} title={NO_SETTING_SELECTED} />}
    />
  )
}
