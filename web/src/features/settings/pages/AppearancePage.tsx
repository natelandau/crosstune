import { useAnalytics } from '../../../usage/AnalyticsProvider'
import { textSizeOffset } from '../../../usage/events'
import {
  APPEARANCE_LABELS,
  APPEARANCES,
  setAppearance,
  setTextSize,
  TEXT_SIZE_LABELS,
  TEXT_SIZES,
  useAppearance,
  useTextSize,
} from '../../../theme/appearance'
import { APPEARANCE_HELP, TEXT_SIZE_LABEL, THEME_LABEL } from '../settingsCopy'
import { Group } from '../../../ui/form/Group'
import { Picker } from '../../../ui/form/Picker'

const THEME_OPTIONS = APPEARANCES.map((id) => ({ id, label: APPEARANCE_LABELS[id] }))
const TEXT_SIZE_OPTIONS = TEXT_SIZES.map((id) => ({ id, label: TEXT_SIZE_LABELS[id] }))

/** The two per-device display settings. Neither writes to the account, so neither can refuse. */
export function AppearancePage() {
  const analytics = useAnalytics()
  const appearance = useAppearance()
  const textSize = useTextSize()
  return (
    <Group help={APPEARANCE_HELP}>
      <Picker
        label={THEME_LABEL}
        value={appearance}
        options={THEME_OPTIONS}
        onChange={(id) => {
          const next = APPEARANCES.find((choice) => choice === id)
          if (!next) return
          setAppearance(next)
          analytics.send('setting_changed', { setting: 'appearance', value: next })
        }}
      />
      <Picker
        label={TEXT_SIZE_LABEL}
        value={textSize}
        options={TEXT_SIZE_OPTIONS}
        onChange={(id) => {
          const next = TEXT_SIZES.find((choice) => choice === id)
          if (!next) return
          setTextSize(next)
          analytics.send('setting_changed', { setting: 'text_size', value: textSizeOffset(next) })
        }}
      />
    </Group>
  )
}
