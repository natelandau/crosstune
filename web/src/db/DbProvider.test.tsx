import { render, waitFor } from '@testing-library/react'
import { StrictMode, useEffect, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { DbProvider, useDb } from './DbProvider'
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

describe('DbProvider', () => {
  afterEach(() => deleteDatabase('u1'))

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
