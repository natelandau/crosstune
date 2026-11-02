import { describe, expect, it } from 'vitest'
import type { LocalRecording } from '../../../db/types'
import { recordingRow } from '../../../test/rows'
import {
  DEFAULT_ISOLATE,
  effectiveIsolate,
  type IsolateSetting,
  isDefaultIsolate,
  isolateFromRow,
  isolateToPatch,
} from './isolateSetting'

function rowOf(setting: IsolateSetting): LocalRecording {
  return recordingRow('r1', isolateToPatch(setting))
}

describe('isolate setting', () => {
  it('treats solo with full ranges as the default', () => {
    expect(DEFAULT_ISOLATE).toEqual({
      effect: 'solo',
      panStart: -100,
      panEnd: 100,
      lowHz: 40,
      highHz: 16000,
    })
    expect(isDefaultIsolate(DEFAULT_ISOLATE)).toBe(true)
  })

  it('treats mute or a narrowed range as not default', () => {
    expect(isDefaultIsolate({ ...DEFAULT_ISOLATE, effect: 'mute' })).toBe(false)
    expect(isDefaultIsolate({ ...DEFAULT_ISOLATE, panStart: -50 })).toBe(false)
    expect(isDefaultIsolate({ ...DEFAULT_ISOLATE, panEnd: 0 })).toBe(false)
    expect(isDefaultIsolate({ ...DEFAULT_ISOLATE, lowHz: 200 })).toBe(false)
    expect(isDefaultIsolate({ ...DEFAULT_ISOLATE, highHz: 4000 })).toBe(false)
  })

  it('takes full pan for a mono recording, which pan cannot change', () => {
    const narrowed: IsolateSetting = { ...DEFAULT_ISOLATE, panStart: -50, panEnd: 0, lowHz: 200 }

    expect(effectiveIsolate(narrowed, true)).toEqual({ ...narrowed, panStart: -100, panEnd: 100 })
    expect(effectiveIsolate(narrowed, false)).toEqual(narrowed)
    expect(isDefaultIsolate(effectiveIsolate({ ...DEFAULT_ISOLATE, panEnd: 0 }, true))).toBe(true)
  })

  it('round-trips through a row and a patch', () => {
    const setting: IsolateSetting = {
      effect: 'mute',
      panStart: -50,
      panEnd: 0,
      lowHz: 200,
      highHz: 4000,
    }
    expect(isolateFromRow(rowOf(setting))).toEqual(setting)
    expect(isolateToPatch(setting)).toEqual({
      isolate_effect: 'mute',
      isolate_pan_start: -50,
      isolate_pan_end: 0,
      isolate_low_hz: 200,
      isolate_high_hz: 4000,
    })
    expect(isolateFromRow(rowOf(DEFAULT_ISOLATE))).toEqual(DEFAULT_ISOLATE)
  })
})
