import { AUDIO_QUALITIES } from '../../../api/vocabulary'
import { RECORDING } from '../../../text/format'
import { useLocationPermission } from '../../../platform/locationPermission'
import { LOCATION_ACCESS_OFF } from '../../recordings/recordingsCopy'
import { QUALITY_LABELS } from '../audioQuality'
import { QUALITY_HELP, QUALITY_LABEL } from '../settingsCopy'
import type { RecordingSettings } from '../useRecordingSettings'
import { Group } from '../../../ui/form/Group'
import { Picker } from '../../../ui/form/Picker'
import { SETTINGS_GROUPS } from '../settingsPaths'

const QUALITY_OPTIONS = AUDIO_QUALITIES.map((id) => ({ id, label: QUALITY_LABELS[id] }))

/**
 * The quality a recording captures at, and a note while the browser keeps recordings from saving
 * where they were made. The web records one channel, so it has no Channels.
 */
export function RecordingGroup({ audio }: { audio: RecordingSettings }) {
  const { quality, setQuality, qualityError } = audio
  const locationOff = useLocationPermission() === 'denied'
  return (
    <>
      <Group
        id={SETTINGS_GROUPS.recording}
        header={RECORDING}
        help={QUALITY_HELP}
        error={qualityError ?? undefined}
      >
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
