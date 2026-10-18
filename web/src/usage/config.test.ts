import { expect, it } from 'vitest'
import { WEB_POSTHOG_CONFIG } from './config'

it('never records sessions', () => {
  expect(WEB_POSTHOG_CONFIG.disable_session_recording).toBe(true)
  expect(WEB_POSTHOG_CONFIG).not.toHaveProperty('session_recording')
})
