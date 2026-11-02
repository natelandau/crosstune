import { ISOLATE_EFFECTS, type IsolateEffect, RECORDING_RANGES } from '../../../api/vocabulary'
import type { LocalRecording } from '../../../db/types'

export type { IsolateEffect }

export type IsolateSetting = {
  effect: IsolateEffect
  panStart: number
  panEnd: number
  lowHz: number
  highHz: number
}

export const DEFAULT_ISOLATE: IsolateSetting = {
  effect: 'solo',
  panStart: RECORDING_RANGES.isolate_pan_start.min,
  panEnd: RECORDING_RANGES.isolate_pan_end.max,
  lowHz: RECORDING_RANGES.isolate_low_hz.min,
  highHz: RECORDING_RANGES.isolate_high_hz.max,
}

// A pulled row may carry an effect from a newer server.
function isIsolateEffect(value: string): value is IsolateEffect {
  return (ISOLATE_EFFECTS as readonly string[]).includes(value)
}

export function isolateEquals(a: IsolateSetting, b: IsolateSetting): boolean {
  return (
    a.effect === b.effect &&
    a.panStart === b.panStart &&
    a.panEnd === b.panEnd &&
    a.lowHz === b.lowHz &&
    a.highHz === b.highHz
  )
}

export function isDefaultIsolate(setting: IsolateSetting): boolean {
  return isolateEquals(setting, DEFAULT_ISOLATE)
}

/** The setting as it sounds: a mono recording has no stereo picture, so its pan is full. Badges,
 * Reset, and whether the stage runs read this; a stored pan stays for a stereo copy. */
export function effectiveIsolate(setting: IsolateSetting, isMono: boolean): IsolateSetting {
  if (!isMono) return setting
  return { ...setting, panStart: DEFAULT_ISOLATE.panStart, panEnd: DEFAULT_ISOLATE.panEnd }
}

/** Whether the stage has nothing to do: the setting as it sounds is the default. */
export function isIsolateOff(setting: IsolateSetting, isMono: boolean): boolean {
  return isDefaultIsolate(effectiveIsolate(setting, isMono))
}

/** Not yet measured reads as stereo, so the stereo range still applies. */
export function isMonoFromRow(row: LocalRecording): boolean {
  return row.is_mono === true
}

export function isolateFromRow(row: LocalRecording): IsolateSetting {
  return {
    effect: isIsolateEffect(row.isolate_effect) ? row.isolate_effect : DEFAULT_ISOLATE.effect,
    panStart: row.isolate_pan_start,
    panEnd: row.isolate_pan_end,
    lowHz: row.isolate_low_hz,
    highHz: row.isolate_high_hz,
  }
}

/** The setting under the recording's wire field names. */
export function isolateToPatch(setting: IsolateSetting) {
  return {
    isolate_effect: setting.effect,
    isolate_pan_start: setting.panStart,
    isolate_pan_end: setting.panEnd,
    isolate_low_hz: setting.lowHz,
    isolate_high_hz: setting.highHz,
  }
}
