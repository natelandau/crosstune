import * as Sentry from '@sentry/react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { sentryOptions } from './errorReporting'

const PRIVATE_NAME = 'Dummy Private List'

afterEach(async () => {
  await Sentry.close()
  document.body.replaceChildren()
})

describe('error reports', () => {
  it('carry no text from the labels of controls the user clicked', async () => {
    const sent: Sentry.ErrorEvent[] = []
    const options = sentryOptions({ VITE_SENTRY_DSN: 'https://public@example.invalid/1' })
    Sentry.init({
      ...options,
      // Recorded here and never sent, so the test reads exactly what would leave the browser.
      beforeSend: (event) => {
        sent.push(event)
        return null
      },
    })
    const button = document.createElement('button')
    button.textContent = 'Play'
    button.setAttribute('aria-label', `Play ${PRIVATE_NAME}`)
    document.body.append(button)

    await userEvent.click(button)
    Sentry.captureException(new Error('report'))

    await expect.poll(() => sent.length).toBe(1)
    expect(JSON.stringify(sent[0])).not.toContain(PRIVATE_NAME)
  })
})
