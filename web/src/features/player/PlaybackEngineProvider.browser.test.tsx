import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { expect, it } from 'vitest'
import type { PlaybackEngine } from './playbackEngine'
import { PlaybackEngineProvider, usePlaybackEngine } from './PlaybackEngineProvider'

it('hands out a live engine after a StrictMode remount', async () => {
  let seen: PlaybackEngine | null = null
  function Probe() {
    seen = usePlaybackEngine()
    return null
  }
  render(
    <StrictMode>
      <PlaybackEngineProvider>
        <Probe />
      </PlaybackEngineProvider>
    </StrictMode>,
  )
  await expect.poll(() => seen?.disposed).toBe(false)
})
