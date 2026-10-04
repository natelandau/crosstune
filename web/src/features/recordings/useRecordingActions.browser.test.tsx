import { IonButton } from '@ionic/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { recordingRow } from '../../test/rows'
import { InlineError } from '../../ui/InlineError'
import { TRIM } from '../recording-screen/TrimView'
import { DELETE } from '../../ui/Confirm'
import { openOn, EDIT } from './recordingCopy'
import { GO_TO_TUNE } from './recordingNames'
import { REMOVE_FROM_TUNE, useRecordingActions } from './useRecordingActions'
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
    const view: RecordingView = {
      recording: recordingRow('r1', { label: 'Jam recording' }),
      file: undefined,
      tuneId: null,
      tuneTitle: null,
    }
    const onTrim = vi.fn()
    function Actions({ blocked }: { blocked?: string }) {
      const { actionsFor, menuFor } = useRecordingActions({
        onEdit: () => {},
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
      <>
        <Actions />
        <Actions blocked="Offline" />
      </>,
      { db: openTestDb() },
    )
    await expect.element(page.getByRole('button', { name: `Row ${EDIT}` })).toBeVisible()
    const labels = () =>
      page
        .getByRole('button')
        .elements()
        .map((element) => element.textContent)
    await expect
      .poll(() => labels().filter((label) => label?.startsWith('Row ')))
      .toEqual([`Row ${EDIT}`, `Row ${DELETE}`])
    await expect
      .poll(() => labels().indexOf(`Menu ${EDIT}`) - labels().indexOf(`Menu ${TRIM}`))
      .toBe(1)
    const blocked = page.getByRole('button', { name: `Blocked menu ${TRIM}` })
    await expect.element(blocked).toBeDisabled()
    await expect.element(blocked).toHaveAttribute('title', 'Offline')
    await page.getByRole('button', { name: `Menu ${TRIM}` }).click()
    await expect.poll(() => onTrim).toHaveBeenCalledOnce()
  })

  it('offers Open on the origin in the menu of an imported recording only, to its page', async () => {
    const url = 'https://www.slippery-hill.com/recording/1'
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const views: RecordingView[] = [
      {
        recording: recordingRow('imported', { origin: 'slippery_hill', origin_url: url }),
        file: undefined,
        tuneId: null,
        tuneTitle: null,
      },
      { recording: recordingRow('own'), file: undefined, tuneId: null, tuneTitle: null },
    ]
    function Actions() {
      const { actionsFor, menuFor } = useRecordingActions({ onEdit: () => {} })
      return (
        <>
          {views.map((view) => (
            <section key={view.recording.id} aria-label={view.recording.id}>
              {actionsFor(view).map((action) => (
                <button type="button" key={action.label} onClick={action.onPress}>
                  {`Row ${action.label}`}
                </button>
              ))}
              {menuFor(view).map((action) => (
                <button type="button" key={action.label} onClick={action.onPress}>
                  {`Menu ${action.label}`}
                </button>
              ))}
            </section>
          ))}
        </>
      )
    }
    renderIonic(<Actions />, { db: openTestDb() })
    const imported = page.getByRole('region', { name: 'imported' })
    const own = page.getByRole('region', { name: 'own' })
    await expect.element(own.getByRole('button', { name: `Row ${EDIT}` })).toBeVisible()
    await expect
      .element(imported.getByRole('button', { name: `Menu ${openOn('Slippery-Hill')}` }))
      .toBeVisible()
    await expect
      .poll(() => imported.getByRole('button', { name: /^Row Open on/ }).elements())
      .toHaveLength(0)
    await expect
      .poll(() => own.getByRole('button', { name: /^Menu Open on/ }).elements())
      .toHaveLength(0)
    await imported.getByRole('button', { name: `Menu ${openOn('Slippery-Hill')}` }).click()
    await expect.poll(() => open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
  })

  it('offers Open on the origin only for an http or https url', async () => {
    const urls = {
      http: 'http://www.slippery-hill.com/recording/1',
      https: 'https://www.slippery-hill.com/recording/1',
      script: 'javascript:alert(1)',
      garbage: 'not a url',
    }
    const views: RecordingView[] = Object.entries(urls).map(([id, url]) => ({
      recording: recordingRow(id, { origin: 'slippery_hill', origin_url: url }),
      file: undefined,
      tuneId: null,
      tuneTitle: null,
    }))
    function Actions() {
      const { menuFor } = useRecordingActions({ onEdit: () => {} })
      return (
        <>
          {views.map((view) => (
            <section key={view.recording.id} aria-label={view.recording.id}>
              {menuFor(view).map((action) => (
                <button type="button" key={action.label}>
                  {`Menu ${action.label}`}
                </button>
              ))}
            </section>
          ))}
        </>
      )
    }
    renderIonic(<Actions />, { db: openTestDb() })
    const open = (id: string) =>
      page.getByRole('region', { name: id }).getByRole('button', { name: /^Menu Open on/ })
    await expect.element(open('http')).toBeVisible()
    await expect.element(open('https')).toBeVisible()
    await expect
      .element(
        page.getByRole('region', { name: 'script' }).getByRole('button', { name: `Menu ${EDIT}` }),
      )
      .toBeVisible()
    await expect
      .element(
        page.getByRole('region', { name: 'garbage' }).getByRole('button', { name: `Menu ${EDIT}` }),
      )
      .toBeVisible()
    await expect.poll(() => open('script').elements()).toHaveLength(0)
    await expect.poll(() => open('garbage').elements()).toHaveLength(0)
  })

  it('offers Go to tune after Remove from tune on a filed view only', async () => {
    const recording = recordingRow('r1', { label: 'Jam recording' })
    const filed: RecordingView = { recording, file: undefined, tuneId: 't1', tuneTitle: 'Reel' }
    const unfiled: RecordingView = { ...filed, tuneId: null, tuneTitle: null }
    const onOpenTune = vi.fn()
    function Actions({ view, prefix }: { view: RecordingView; prefix: string }) {
      const { actionsFor } = useRecordingActions({ onOpenTune })
      return actionsFor(view).map((action) => (
        <button type="button" key={action.label} onClick={action.onPress}>
          {`${prefix} ${action.label}`}
        </button>
      ))
    }
    renderIonic(
      <>
        <Actions view={filed} prefix="Filed" />
        <Actions view={unfiled} prefix="Unfiled" />
      </>,
      { db: openTestDb() },
    )
    const labels = () =>
      page
        .getByRole('button')
        .elements()
        .map((element) => element.textContent)
    await expect
      .poll(() => labels().filter((label) => label?.startsWith('Filed ')))
      .toEqual([`Filed ${REMOVE_FROM_TUNE}`, `Filed ${GO_TO_TUNE}`, `Filed ${DELETE}`])
    expect(labels()).not.toContain(`Unfiled ${GO_TO_TUNE}`)
    await page.getByRole('button', { name: `Filed ${GO_TO_TUNE}` }).click()
    await expect.poll(() => onOpenTune).toHaveBeenCalledWith(filed)
  })

  it('leaves Go to tune out of a filed view without a handler', async () => {
    const recording = recordingRow('r1', { label: 'Jam recording' })
    const filed: RecordingView = { recording, file: undefined, tuneId: 't1', tuneTitle: 'Reel' }
    function Actions() {
      const { actionsFor } = useRecordingActions({})
      return actionsFor(filed).map((action) => (
        <button type="button" key={action.label}>
          {action.label}
        </button>
      ))
    }
    renderIonic(<Actions />, { db: openTestDb() })
    const labels = () =>
      page
        .getByRole('button')
        .elements()
        .map((element) => element.textContent)
    await expect.poll(labels).toContain(REMOVE_FROM_TUNE)
    expect(labels()).not.toContain(GO_TO_TUNE)
  })
})
