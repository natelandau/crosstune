import { PROVIDER_LABELS } from '../../../constants'
import { PLAY_FIRST, PLAY_FIRST_HELP, PLAY_FIRST_LABEL, PLAY_FIRST_LABELS } from '../playFirst'
import { MUSIC_SERVICES_HELP, SEARCHABLE_PROVIDERS } from '../searchProviders'
import { useMusicServicesSetting } from '../useMusicServicesSetting'
import { Group } from '../../../ui/form/Group'
import { Picker } from '../../../ui/form/Picker'
import { Switch } from '../../../ui/form/Switch'

const PLAY_FIRST_OPTIONS = PLAY_FIRST.map((id) => ({ id, label: PLAY_FIRST_LABELS[id] }))
const isPlayFirst = (id: string | null) => PLAY_FIRST.find((choice) => choice === id)

/** The services a tune's recording search covers, and which version plays first. */
export function MusicServicesPage() {
  const { providers, toggle, error, playFirst, setPlayFirst, playFirstError } =
    useMusicServicesSetting()
  if (!providers) return null
  return (
    <>
      <Group footer={MUSIC_SERVICES_HELP} error={error ?? undefined}>
        {SEARCHABLE_PROVIDERS.map((provider) => (
          <Switch
            key={provider}
            label={PROVIDER_LABELS[provider]}
            isSelected={providers.has(provider)}
            onChange={(on) => toggle(provider, on)}
          />
        ))}
      </Group>
      <Group footer={PLAY_FIRST_HELP} error={playFirstError ?? undefined}>
        <Picker
          label={PLAY_FIRST_LABEL}
          value={playFirst}
          options={PLAY_FIRST_OPTIONS}
          onChange={(id) => {
            const next = isPlayFirst(id)
            if (next) setPlayFirst(next)
          }}
        />
      </Group>
    </>
  )
}
