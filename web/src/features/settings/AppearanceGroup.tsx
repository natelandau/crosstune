import { ChoiceRow } from '../../ui/ChoiceRow'
import { Group } from '../../ui/Group'
import {
  APPEARANCE_LABELS,
  APPEARANCES,
  setAppearance,
  setTextSize,
  TEXT_SIZE_LABELS,
  TEXT_SIZES,
  useAppearance,
  useTextSize,
} from './appearance'

export const TEXT_SIZE_LABEL = 'Text size'
export const APPEARANCE_FOOTER =
  'These apply to this device only. System follows the phone when it switches.'

/** The two per-device display settings. Neither writes to the account, so neither can refuse. */
export function AppearanceGroup() {
  const appearance = useAppearance()
  const textSize = useTextSize()
  return (
    <Group header="Appearance" footer={APPEARANCE_FOOTER}>
      <ChoiceRow
        label="Theme"
        value={appearance}
        options={APPEARANCES}
        labels={APPEARANCE_LABELS}
        onChange={setAppearance}
      />
      <ChoiceRow
        label={TEXT_SIZE_LABEL}
        value={textSize}
        options={TEXT_SIZES}
        labels={TEXT_SIZE_LABELS}
        onChange={setTextSize}
      />
    </Group>
  )
}
