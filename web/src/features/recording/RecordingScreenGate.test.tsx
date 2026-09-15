import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/render'

class FakeTrack extends EventTarget {
  muted = false
  stop = vi.fn()
}

class FakeRecorder extends EventTarget {
  static isTypeSupported = (m: string) => m === 'audio/mp4'
  state = 'inactive'
  mimeType = 'audio/mp4'
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  }
}

let db: CrosstuneDb
let track: FakeTrack

beforeEach(() => {
  db = openTestDb()
  track = new FakeTrack()
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      resume = vi.fn(async () => {})
      suspend = vi.fn(async () => {})
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
      createAnalyser = () => ({ fftSize: 0, frequencyBinCount: 16, getByteTimeDomainData: vi.fn() })
    },
  )
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      })),
    },
  })
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persist: vi.fn(async () => true) },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})

describe('RecordingScreen without a prior tap', () => {
  it('shows a start button instead of starting the microphone on its own', async () => {
    renderApp({ db, path: '/record' })
    expect(await screen.findByRole('button', { name: 'Start recording' })).toBeInTheDocument()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(screen.queryByRole('timer')).toBeNull()
  })

  it('starts the take once the start button is tapped', async () => {
    renderApp({ db, path: '/record' })
    await userEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('timer')
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })
})
