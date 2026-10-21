import { useState } from 'react'
import type { RecordingPlace } from '../../commands/recordings'
import { useLocationPermission } from '../../platform/locationPermission'
import { readStored, writeStored } from '../../platform/storage'
import { devicePosition } from './devicePosition'

const SEEN_KEY = 'crosstune.locationNoteSeen'

export interface LocationNote {
  /** True once the take may start. It never turns back, so a later permission change never
   * pulls a live take behind the note. */
  armed: boolean
  /** Whether the note shows in place of the recorder. */
  showing: boolean
  /** True from Continue until the browser has answered. */
  asking: boolean
  /** Asks for the position once, which raises the browser's prompt, then arms the take. */
  proceed: () => void
  /** The request Continue made, which the take reads its place from rather than asking again,
   * since a second request raises a dismissed prompt once more. Null until Continue. */
  position: Promise<RecordingPlace | null> | null
}

/**
 * The note before the first take on a device whose browser has yet to ask for location, so the
 * prompt arrives explained. A take waits only while the permission is unread, and skips the
 * note when the browser has already answered or cannot say.
 */
export function useLocationNote(): LocationNote {
  const [seen] = useState(() => readStored(SEEN_KEY) !== null)
  const permission = useLocationPermission()
  const [armed, setArmed] = useState(seen)
  const [position, setPosition] = useState<Promise<RecordingPlace | null> | null>(null)
  // The prompt's answer shows here first; a dismissed prompt stays 'prompt' and arms through
  // the failed request instead.
  if (!armed && permission !== null && permission !== 'prompt') setArmed(true)

  const proceed = () => {
    if (position) return
    writeStored(SEEN_KEY, '1')
    const asked = devicePosition(navigator.geolocation)
    setPosition(asked)
    void asked.then(() => setArmed(true))
  }

  return {
    armed,
    showing: !armed && permission === 'prompt',
    asking: position !== null,
    proceed,
    position,
  }
}
