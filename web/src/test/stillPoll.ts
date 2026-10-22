import { expect } from 'vitest'

/**
 * `expect.poll` and `expect.element` that leave a fake clock where the test put it. Under fake
 * timers, each miss advances them by the poll's interval, so a poll taken before a fake deadline
 * can spend the time the test means to hold and fire a timer early.
 */
export const pollStill = <T>(read: () => T) => expect.poll(read, { interval: 0 })

export const elementStill = (target: Parameters<typeof expect.element>[0]) =>
  expect.element(target, { interval: 0 })
