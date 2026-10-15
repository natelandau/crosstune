import type { AnalyticsClient } from './client'
import type { EventName, PersonProperties, Screen } from './events'

export type AnalyticsCall =
  | { type: 'send'; name: EventName; props: object }
  | { type: 'screen'; name: Screen }
  | { type: 'identify'; userId: string; person: PersonProperties; signedUpAt?: string }
  | { type: 'setPerson'; person: PersonProperties }
  | { type: 'reset' }
  | { type: 'disable' }
  | { type: 'enable' }

/**
 * A client that records every call in order, for tests of code that reports. It remembers the
 * identified user as the real client does, starting from `user`.
 */
export function recordingAnalytics({
  user = null,
}: { user?: string | null } = {}): AnalyticsClient & {
  calls: AnalyticsCall[]
  sends(): { name: EventName; props: object }[]
} {
  const calls: AnalyticsCall[] = []
  let remembered = user
  let identified: string | null = null
  let waiting: { userId: string; fn: () => void }[] = []
  return {
    calls,
    sends: () =>
      calls.flatMap((call) =>
        call.type === 'send' ? [{ name: call.name, props: call.props }] : [],
      ),
    send: (name, props) => void calls.push({ type: 'send', name, props }),
    screen: (name) => void calls.push({ type: 'screen', name }),
    identify: (userId, person, signedUpAt) => {
      remembered = userId
      identified = userId
      calls.push({
        type: 'identify',
        userId,
        person,
        ...(signedUpAt === undefined ? {} : { signedUpAt }),
      })
      const ready = waiting.filter((waiter) => waiter.userId === userId)
      waiting = []
      for (const { fn } of ready) fn()
    },
    whenIdentified: (userId, fn) => {
      if (identified === userId) fn()
      else waiting.push({ userId, fn })
    },
    setPerson: (person) => void calls.push({ type: 'setPerson', person }),
    reset: () => {
      remembered = null
      identified = null
      calls.push({ type: 'reset' })
    },
    identifiedUser: () => remembered,
    disableSharing: () => {
      calls.push({ type: 'disable' })
      return Promise.resolve()
    },
    enableSharing: () => {
      calls.push({ type: 'enable' })
      return Promise.resolve()
    },
  }
}
