import { fireEvent } from '@testing-library/react'
import { expect } from 'vitest'
import type { Locator } from 'vitest/browser'

/**
 * `expect.poll` and `expect.element` that leave a fake clock where the test put it. Under fake
 * timers, each miss advances them by the poll's interval, so a poll taken before a fake deadline
 * can spend the time the test means to hold and fire a timer early.
 */
export const pollStill = <T>(read: () => T) => expect.poll(read, { interval: 0 })

export const elementStill = (target: Parameters<typeof expect.element>[0]) =>
  expect.element(target, { interval: 0 })

/**
 * Focuses the shown field and sets its text in one change event, leaving a fake clock where the
 * test put it. A browser action such as `fill` advances fake timers 50 ms for each 50 ms it runs,
 * so a slow runner can pass a deadline the test means to hold.
 */
export function fillStill(target: Locator, text: string) {
  const field = target.element() as HTMLInputElement
  field.focus()
  fireEvent.change(field, { target: { value: text } })
}
