import { useUser } from '@clerk/react'
import * as Sentry from '@sentry/react'
import { useEffect, useRef } from 'react'
import { useAuthSession } from '../auth/AuthContext'
import { useDb } from '../db/DbProvider'
import { useStorage } from '../db/useStorage'
import { useAnalytics } from './AnalyticsProvider'
import type { PersonProperties } from './events'
import { personProperties, readWebSettings } from './personProperties'

/**
 * Identifies the admitted musician to analytics. Mounted inside the gate and the database, it
 * is gone while a sign-out or deletion ends the session, so nothing identifies then.
 */
export function AnalyticsIdentity() {
  const analytics = useAnalytics()
  const db = useDb()
  const { userId, offline } = useAuthSession()
  const { user } = useUser()
  // Clerk has no user in an offline session; the ISO string keeps the effect from re-running
  // on a new Date instance for the same moment.
  const signedUpAt = user?.createdAt?.toISOString()
  const missedUsage = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // A failed read still identifies the person, without the properties it could not read.
      let person: PersonProperties = {}
      try {
        person = await personProperties(db, await readWebSettings(db, userId))
      } catch (error) {
        if (cancelled) return
        Sentry.captureException(error)
        missedUsage.current = true
      }
      if (cancelled) return
      if (!offline) {
        // Read before `identify`, which replaces the remembered user.
        const previous = analytics.identifiedUser()
        // A previous person still identified would receive `signed_in`, which PostHog never
        // moves to the new person.
        if (previous !== null && previous !== userId) analytics.reset()
        if (previous !== userId) analytics.send('signed_in', {})
      }
      analytics.identify(userId, person, signedUpAt)
    })()
    return () => {
      cancelled = true
    }
  }, [analytics, db, userId, offline, signedUpAt])

  // The first sync that brings the account's storage usage completes the person. A store that
  // already held it was covered by the identify above. Until the person is set, each change
  // to the usage tries again.
  const storage = useStorage()
  useEffect(() => {
    if (storage === undefined) return
    if (storage === null) {
      missedUsage.current = true
      return
    }
    if (!missedUsage.current) return
    let cancelled = false
    void readWebSettings(db, userId)
      .then((settings) => personProperties(db, settings))
      .then((person) => {
        if (cancelled) return
        missedUsage.current = false
        analytics.setPerson(person)
      })
      .catch((error: unknown) => Sentry.captureException(error))
    return () => {
      cancelled = true
    }
  }, [analytics, db, userId, storage])

  return null
}
