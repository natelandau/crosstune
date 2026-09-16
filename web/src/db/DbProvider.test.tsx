import { render, waitFor } from '@testing-library/react'
import { StrictMode, useEffect, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { DbProvider, useDb } from './DbProvider'
import type { CrosstuneDb } from './schema'
import { deleteDatabase } from './schema'

function Probe() {
  const db = useDb()
  const [result, setResult] = useState('pending')
  useEffect(() => {
    db.songs
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

describe('DbProvider', () => {
  afterEach(() => deleteDatabase('u1'))

  it('leaves a database that was closed for good closed after it unmounts', async () => {
    const dbRef: { current: CrosstuneDb | null } = { current: null }
    const { unmount } = render(
      <DbProvider userId="u1">
        <Capture dbRef={dbRef} />
      </DbProvider>,
    )
    await waitFor(() => expect(dbRef.current).not.toBeNull())
    const db = dbRef.current!
    await db.songs.count()
    db.close()
    unmount()
    await expect(db.songs.count()).rejects.toMatchObject({ name: 'DatabaseClosedError' })
  })

  it('serves queries after a StrictMode remount closes and reopens the database', async () => {
    const { getByTestId } = render(
      <StrictMode>
        <DbProvider userId="u1">
          <Probe />
        </DbProvider>
      </StrictMode>,
    )
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('ok:0'))
  })
})
