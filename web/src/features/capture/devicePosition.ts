import { RECORDING_RANGES } from '../../api/vocabulary'
import type { RecordingPlace } from '../../commands/recordings'

const { max: WIDEST_ACCURACY } = RECORDING_RANGES.place_accuracy_m

/** The device's position, or null on any failure, a denial, or no geolocation API. */
export function devicePosition(geo: Geolocation | undefined): Promise<RecordingPlace | null> {
  return new Promise((resolve) => {
    if (!geo) return resolve(null)
    try {
      geo.getCurrentPosition(
        ({ coords }) =>
          resolve({
            lat: coords.latitude,
            lon: coords.longitude,
            accuracyM: Number.isFinite(coords.accuracy)
              ? Math.min(Math.round(coords.accuracy), WIDEST_ACCURACY)
              : null,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 },
      )
    } catch {
      resolve(null)
    }
  })
}
