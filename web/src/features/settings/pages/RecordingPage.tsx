import { AUDIO_QUALITIES } from '../../../api/vocabulary'
import { useLocationPermission } from '../../../platform/locationPermission'
import { LOCATION_ACCESS_OFF } from '../../recordings/recordingsCopy'
import { QUALITY_LABELS } from '../audioQuality'
import { QUALITY_HELP, QUALITY_LABEL } from '../settingsCopy'
import { useRecordingSettings } from '../useRecordingSettings'
import { Group } from '../../../ui/form/Group'
import { Picker } from '../../../ui/form/Picker'

const QUALITY_OPTIONS = AUDIO_QUALITIES.map((id) => ({ id, label: QUALITY_LABELS[id] }))

/**
 * The quality a recording captures at, and a note while the browser keeps takes from saving
 * where they were made. The web records one channel, so it has no Channels.
 */
export function RecordingPage() {
  const { quality, setQuality, qualityError } = useRecordingSettings()
  const locationOff = useLocationPermission() === 'denied'
  return (
    <>
      <Group help={QUALITY_HELP} error={qualityError ?? undefined}>
        <Picker
          label={QUALITY_LABEL}
          value={quality}
          options={QUALITY_OPTIONS}
          onChange={(id) => {
            const next = AUDIO_QUALITIES.find((choice) => choice === id)
            if (next) setQuality(next)
          }}
        />
      </Group>
      {locationOff && <p className="t-secondary text-ink-2 px-4 pt-6">{LOCATION_ACCESS_OFF}</p>}
    </>
  )
}
