import { page } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { pollStill } from '../../test/stillPoll'
import { WORKING } from '../../ui/WorkingMark'
import { DONE_HOLD_MS, WORKING_DELAY_MS, type TrackWork } from '../../ui/useWorking'
import { EditorHeader } from './EditorHeader'
import { useEditorSave } from './useEditorSave'

const SAVE = 'Save trim'

const announced = () =>
  page.getByRole('button', { name: SAVE }).element().nextElementSibling?.textContent ?? null

it('shows Save working only once the question is answered, and no check after', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    let answer!: () => void
    const asked = new Promise<void>((resolve) => (answer = resolve))
    let land!: () => void
    const onSave = vi.fn((track: TrackWork) => {
      void asked.then(() => track(new Promise<void>((resolve) => (land = resolve))))
    })
    renderWithProviders(
      <EditorHeader
        title="Trim"
        saveLabel={SAVE}
        isTop={() => true}
        saving={false}
        canSave
        onDone={() => {}}
        onSave={onSave}
      />,
    )
    const save = page.getByRole('button', { name: SAVE })
    await expect.element(save).toBeVisible()
    ;(save.element() as HTMLElement).click()
    await pollStill(() => onSave).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2 * WORKING_DELAY_MS)
    expect(announced()).toBe('')
    answer()
    await vi.advanceTimersByTimeAsync(WORKING_DELAY_MS)
    await pollStill(announced).toBe(WORKING)
    land()
    await pollStill(announced).toBe('')
    await vi.advanceTimersByTimeAsync(DONE_HOLD_MS)
    expect(announced()).toBe('')
  } finally {
    vi.useRealTimers()
  }
})

it('shakes Save and says why when the confirmed write fails', async () => {
  function Harness() {
    const editor = useEditorSave({
      recording: { trim_start_ms: 0, trim_end_ms: 0 },
      confirm: async () => true,
      onTrimmedElsewhere: () => {},
      failure: 'Could not save the trim.',
    })
    return (
      <>
        <EditorHeader
          title="Trim"
          saveLabel={SAVE}
          isTop={() => true}
          saving={editor.saving}
          canSave
          onDone={() => {}}
          onSave={(track) =>
            void editor.save(
              { title: 'Trim?', message: 'Trim it.', action: 'Trim' },
              () => Promise.reject(new Error('Offline')),
              track,
            )
          }
        />
        <p role="alert">{editor.error}</p>
      </>
    )
  }
  renderWithProviders(<Harness />)
  const save = page.getByRole('button', { name: SAVE })
  await expect.element(save).toBeVisible()
  // Read from the call rather than the running animation, which ends on its own.
  const animate = vi.spyOn(HTMLElement.prototype, 'animate')
  ;(save.element() as HTMLElement).click()
  await expect.element(page.getByRole('alert')).toHaveTextContent('Could not save the trim.')
  await expect.poll(() => animate.mock.contexts).toContain(save.element())
})
