import { RECORDING_RANGES } from '../../api/vocabulary'
import {
  STEREO_CENTER,
  STEREO_EDGE_VALUE,
  STEREO_EVERYTHING,
  STEREO_LEFT,
  STEREO_LEFT_OF_CENTER,
  STEREO_MEDIUM,
  STEREO_NARROW,
  STEREO_RIGHT,
  STEREO_RIGHT_OF_CENTER,
  STEREO_WIDE,
} from './practiceCopy'

/** `Left of center`, where a place in the stereo picture (-100 to 100) sits. */
export function stereoPosition(pan: number): string {
  const distance = Math.abs(pan)
  if (distance < 10) return STEREO_CENTER
  if (distance >= 60) return pan < 0 ? STEREO_LEFT : STEREO_RIGHT
  return pan < 0 ? STEREO_LEFT_OF_CENTER : STEREO_RIGHT_OF_CENTER
}

/** `Left of center, 35 left`, one stereo edge as a screen reader says it. */
export function stereoEdgeReadout(pan: number): string {
  return STEREO_EDGE_VALUE(stereoPosition(pan), pan)
}

function stereoWidth(width: number): string {
  if (width < 25) return STEREO_NARROW
  if (width < 60) return STEREO_MEDIUM
  return STEREO_WIDE
}

/** `Left of center, medium`: where the stereo range sits and how wide it is. */
export function stereoReadout(start: number, end: number): string {
  if (
    start <= RECORDING_RANGES.isolate_pan_start.min &&
    end >= RECORDING_RANGES.isolate_pan_end.max
  )
    return STEREO_EVERYTHING
  return `${stereoPosition((start + end) / 2)}, ${stereoWidth(end - start)}`
}

/** `200 Hz` or `4.1 kHz`. */
export function hzReadout(hz: number): string {
  if (hz < 1000) return `${Math.round(hz)} Hz`
  // Half up on tenths, as the Apple app rounds; `toFixed` rounds the binary value.
  return `${Math.round(hz / 100) / 10} kHz`
}

/** `200 Hz to 4.1 kHz`. */
export function frequencyReadout(lowHz: number, highHz: number): string {
  return `${hzReadout(lowHz)} to ${hzReadout(highHz)}`
}
