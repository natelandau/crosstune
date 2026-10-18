import { describe, expect, it, vi } from 'vitest'
import { RECORDING_RANGES } from '../../api/vocabulary'
import { devicePosition } from './devicePosition'

const geo = (impl: Geolocation['getCurrentPosition']) =>
  ({ getCurrentPosition: vi.fn(impl) }) as unknown as Geolocation

describe('devicePosition', () => {
  it('resolves the fix at full coordinate precision, rounding only the accuracy', async () => {
    const g = geo((ok) =>
      ok({
        coords: { latitude: 36.661234567, longitude: -80.923912345, accuracy: 11.6 },
      } as GeolocationPosition),
    )
    expect(await devicePosition(g)).toEqual({
      lat: 36.661234567,
      lon: -80.923912345,
      accuracyM: 12,
    })
    expect(g.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: 60_000,
      timeout: 30_000,
    })
  })

  it('reports a non-finite accuracy as unknown', async () => {
    const g = geo((ok) =>
      ok({ coords: { latitude: 1, longitude: 2, accuracy: Number.NaN } } as GeolocationPosition),
    )
    expect(await devicePosition(g)).toEqual({ lat: 1, lon: 2, accuracyM: null })
  })

  it('stores an accuracy wider than the API takes as its widest', async () => {
    const widest = RECORDING_RANGES.place_accuracy_m.max
    const g = geo((ok) =>
      ok({ coords: { latitude: 1, longitude: 2, accuracy: widest * 3 } } as GeolocationPosition),
    )
    expect(await devicePosition(g)).toEqual({ lat: 1, lon: 2, accuracyM: widest })
  })

  it('resolves null on an error, a throw, or no API', async () => {
    expect(
      await devicePosition(geo((_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError))),
    ).toBeNull()
    expect(
      await devicePosition(
        geo(() => {
          throw new Error('x')
        }),
      ),
    ).toBeNull()
    expect(await devicePosition(undefined)).toBeNull()
  })
})
