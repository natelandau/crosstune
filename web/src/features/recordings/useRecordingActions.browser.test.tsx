import { IonButton } from '@ionic/react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { InlineError } from '../../ui/InlineError'
import { useRecordingActions } from './useRecordingActions'

/** Stands in for a list of recordings: one line for every refusal, wherever the control sits. */
function Host() {
  const { error, setUploadError, run } = useRecordingActions({ onRename: vi.fn() })
  return (
    <>
      <IonButton onClick={() => run(() => Promise.reject(new Error('Refused')))}>
        Refuse a row action
      </IonButton>
      <IonButton onClick={() => setUploadError('Choose an audio file.')}>
        Refuse an upload
      </IonButton>
      <IonButton onClick={() => setUploadError(null)}>Take a good file</IonButton>
      {error ? <InlineError>{error}</InlineError> : null}
    </>
  )
}

describe('useRecordingActions', () => {
  it('reports a refused row action on the shared line', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await page.getByRole('button', { name: 'Refuse a row action' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Refused')
  })

  it('leaves the line empty once an upload succeeds after both kinds of refusal', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await page.getByRole('button', { name: 'Refuse a row action' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Refused')
    await page.getByRole('button', { name: 'Refuse an upload' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Choose an audio file.')
    await page.getByRole('button', { name: 'Take a good file' }).click()
    await vi.waitFor(() => expect(page.getByRole('alert').elements()).toHaveLength(0))
  })
})
