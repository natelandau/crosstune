import { render, waitFor } from '@testing-library/react'
import { StrictMode, useEffect, useState } from 'react'
import { describe, expect, it, onTestFinished } from 'vitest'
import { DbProvider, useDb } from './DbProvider'
import type { CrosstuneDb } from './schema'
import { deleteDatabase } from './schema'

function Probe() {
  const db = useDb()
  const [result, setResult] = useState('pending')
  useEffect(() => {
    db.tunes
      .count()
      .then((count) => setResult(`ok:${count}`))
      .catch((error: Error) => setResult(`error:${error.name}`))
  }, [db])
  return <output data-testid="probe">{result}</output>
}

function Capture({ dbRef }: { dbRef: { current: CrosstuneDb | null } }) {
  const db = useDb()
  useEffect(() => {
    dbRef.current = db
  }, [db, dbRef])
  return null
}

/**
 * A user whose database is deleted once the test finishes, after the setup file's unmount, so
 * no provider still holds it open. DbProvider opens by user, so `openTestDb()` cannot stand in.
 */
function testUser(): string {
  const userId = `u-${crypto.randomUUID()}`
  onTestFinished(() => deleteDatabase(userId))
  return userId
}

describe('DbProvider', () => {
  it('leaves a database that was closed for good closed after it unmounts', async () => {
    const userId = testUser()
    const dbRef: { current: CrosstuneDb | null } = { current: null }
    const { unmount } = render(
      <DbProvider userId={userId}>
        <Capture dbRef={dbRef} />
      </DbProvider>,
    )
    await waitFor(() => expect(dbRef.current).not.toBeNull())
    const db = dbRef.current!
    await db.tunes.count()
    db.close()
    unmount()
    await expect(db.tunes.count()).rejects.toMatchObject({ name: 'DatabaseClosedError' })
  })

  it('serves queries after a StrictMode remount closes and reopens the database', async () => {
    const userId = testUser()
    const { getByTestId } = render(
      <StrictMode>
        <DbProvider userId={userId}>
          <Probe />
        </DbProvider>
      </StrictMode>,
    )
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('ok:0'))
  })
})
