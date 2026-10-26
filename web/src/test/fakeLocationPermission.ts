import { onTestFinished } from 'vitest'
import type { LocationPermission } from '../platform/locationPermission'

export interface FakeLocationPermission {
  /** Answers every later query with `state`, and tells a status already handed out. */
  set: (state: LocationPermission) => void
}

class FakeStatus extends EventTarget {
  readonly name = 'geolocation'
  onchange = null
  constructor(public state: PermissionState) {
    super()
  }
}

let active: { state: LocationPermission; status: FakeStatus | null } | null = null

/**
 * Answers `navigator.permissions` for geolocation with `state` for one test, 'unknown' being a
 * query that fails. A second call in the same test changes the answer in place, and the real
 * `navigator.permissions` comes back when the test ends.
 */
export function fakeLocationPermissionForTest(state: LocationPermission): FakeLocationPermission {
  const controller: FakeLocationPermission = {
    set: (next) => {
      if (!active) return
      active.state = next
      const { status } = active
      if (status && next !== 'unknown' && status.state !== next) {
        status.state = next
        status.dispatchEvent(new Event('change'))
      }
    },
  }
  if (active) {
    controller.set(state)
    return controller
  }
  const fake = { state, status: null as FakeStatus | null }
  active = fake
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'permissions')
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: async ({ name }: PermissionDescriptor) => {
        if (name !== 'geolocation' || fake.state === 'unknown') {
          throw new TypeError(`No permission state for ${name}`)
        }
        fake.status ??= new FakeStatus(fake.state)
        return fake.status
      },
    },
  })
  onTestFinished(() => {
    active = null
    if (descriptor) Object.defineProperty(navigator, 'permissions', descriptor)
    else Reflect.deleteProperty(navigator, 'permissions')
  })
  return controller
}

/** 'unknown' for this test unless it already set an answer, so a recording starts with no note. */
export function quietLocationPermissionForTest(): void {
  if (!active) fakeLocationPermissionForTest('unknown')
}
