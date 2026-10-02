import { IonButton } from '@ionic/react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { recordingRow } from '../../test/rows'
import { InlineError } from '../../ui/InlineError'
import { TRIM } from '../recording-screen/TrimView'
import {
  EDIT_RECORDING,
  RecordingScreenContext,
  type RecordingScreen,
} from '../recording-screen/useRecordingScreen'
import { RENAME } from './recordingCopy'
import { useRecordingActions } from './useRecordingActions'
import type { RecordingView } from './useRecordings'

/** Stands in for a list of recordings: one line for every refusal, wherever the control sits. */
function Host() {
  const { error, setUploadError, run } = useRecordingActions({})
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

  it('offers Trim first, only in the menu, disabled with its reason while blocked', async () => {
    const screen: RecordingScreen = {
      open: vi.fn(),
      close: () => {},
      held: () => null,
      hold: () => {},
      subscribe: () => () => {},
    }
    const view: RecordingView = {
      recording: recordingRow('r1', { label: 'Jam recording' }),
      file: undefined,
      tuneId: null,
      tuneTitle: null,
    }
    const onTrim = vi.fn()
    function Actions({ blocked }: { blocked?: string }) {
      const { actionsFor, menuFor } = useRecordingActions({
        onRename: () => {},
        onTrim,
        trimBlocked: blocked,
      })
      const prefix = blocked ? 'Blocked menu' : 'Menu'
      return (
        <>
          {blocked
            ? null
            : actionsFor(view).map((action) => (
                <button type="button" key={action.label} onClick={action.onPress}>
                  {`Row ${action.label}`}
                </button>
              ))}
          {menuFor(view).map((action) => (
            <button
              type="button"
              key={action.label}
              disabled={!!action.disabled}
              title={action.disabled}
              onClick={action.onPress}
            >
              {`${prefix} ${action.label}`}
            </button>
          ))}
        </>
      )
    }
    renderIonic(
      <RecordingScreenContext.Provider value={screen}>
        <Actions />
        <Actions blocked="Offline" />
      </RecordingScreenContext.Provider>,
      { db: openTestDb() },
    )
    await expect.element(page.getByRole('button', { name: `Row ${EDIT_RECORDING}` })).toBeVisible()
    const labels = page
      .getByRole('button')
      .elements()
      .map((element) => element.textContent)
    expect(labels).not.toContain(`Row ${TRIM}`)
    expect(labels.indexOf(`Menu ${TRIM}`)).toBe(labels.indexOf(`Menu ${RENAME}`) - 1)
    const blocked = page.getByRole('button', { name: `Blocked menu ${TRIM}` })
    await expect.element(blocked).toBeDisabled()
    await expect.element(blocked).toHaveAttribute('title', 'Offline')
    await page.getByRole('button', { name: `Menu ${TRIM}` }).click()
    expect(onTrim).toHaveBeenCalledOnce()
    expect(screen.open).not.toHaveBeenCalled()
  })
})
