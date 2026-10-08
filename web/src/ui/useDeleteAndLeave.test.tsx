import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDeleteAndLeave } from './useDeleteAndLeave'

const ASK = { title: 'Delete it?', message: 'It goes.', action: 'Delete' }

/** A promise and the function that settles it, for holding a write in flight. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

function setup({
  answer = true,
  remove = vi.fn(async () => {}),
}: { answer?: boolean; remove?: () => Promise<void> } = {}) {
  const calls: string[] = []
  const confirm = vi.fn(async () => {
    calls.push('confirm')
    return answer
  })
  const leave = vi.fn(() => {
    calls.push('leave')
  })
  const removing = vi.fn(async () => {
    calls.push('remove')
    await remove()
  })
  const hook = renderHook(() => useDeleteAndLeave({ confirm, remove: removing, leave }))
  return { ...hook, confirm, leave, removing, calls }
}

describe('useDeleteAndLeave', () => {
  it('confirms, removes, then leaves, naming the thing while it runs', async () => {
    const hold = gate()
    const { result, calls } = setup({ remove: () => hold.opened })
    expect(result.current.deletingName).toBeNull()
    act(() => {
      void result.current.start('Angeline', ASK)
    })
    await waitFor(() => expect(result.current.deletingName).toBe('Angeline'))
    expect(calls).toEqual(['confirm', 'remove'])
    hold.open()
    await waitFor(() => expect(calls).toEqual(['confirm', 'remove', 'leave']))
  })

  it('does nothing when the question is declined, and can be asked again', async () => {
    const { result, removing, leave, confirm } = setup({ answer: false })
    await act(() => result.current.start('Angeline', ASK))
    expect(removing).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()
    expect(result.current.deletingName).toBeNull()
    await act(() => result.current.start('Angeline', ASK))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('asks once for two presses in one tick', async () => {
    const { result, confirm, removing } = setup()
    await act(async () => {
      await Promise.all([
        result.current.start('Angeline', ASK),
        result.current.start('Angeline', ASK),
      ])
    })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(removing).toHaveBeenCalledTimes(1)
  })

  it('reports a failed removal, stays put, and allows a retry', async () => {
    const remove = vi.fn().mockRejectedValueOnce(new Error('Refused')).mockResolvedValue(undefined)
    const onError = vi.fn()
    const onStart = vi.fn()
    const confirm = async () => true
    const leave = vi.fn()
    const { result } = renderHook(() =>
      useDeleteAndLeave({ confirm, remove, leave, onStart, onError }),
    )
    await act(() => result.current.start('Angeline', ASK))
    expect(onError).toHaveBeenCalledWith('Refused')
    expect(result.current.deletingName).toBeNull()
    expect(leave).not.toHaveBeenCalled()
    await act(() => result.current.start('Angeline', ASK))
    expect(onStart).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(leave).toHaveBeenCalledTimes(1)
  })

  // One shape serves a tune page and a list page: each binds its remove to the id on screen.
  it('deletes nothing and does not leave when the subject changes under a question', async () => {
    let answer: (ok: boolean) => void = () => {}
    const asked = new Promise<boolean>((resolve) => {
      answer = resolve
    })
    const removed: string[] = []
    const leave = vi.fn()
    const onStart = vi.fn()
    const onError = vi.fn()
    const confirm = vi.fn(() => asked)
    // Each render's remove names the subject on screen, as a page's closure does.
    const { result, rerender } = renderHook(
      ({ subject }) =>
        useDeleteAndLeave({
          confirm,
          remove: async () => {
            removed.push(subject)
          },
          leave,
          onStart,
          onError,
          subject,
        }),
      { initialProps: { subject: 'first' } },
    )
    let started: Promise<void> = Promise.resolve()
    act(() => {
      started = result.current.start('First', ASK)
    })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    rerender({ subject: 'second' })
    await act(async () => {
      answer(true)
      await started
    })
    expect(removed).toEqual([])
    expect(leave).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()
    expect(result.current.deletingName).toBeNull()
  })

  it('lets the new subject ask while the old question is still up, and deletes only its own', async () => {
    const answers: ((ok: boolean) => void)[] = []
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answers.push(resolve)
        }),
    )
    const removed: string[] = []
    const leave = vi.fn()
    const { result, rerender } = renderHook(
      ({ subject }) =>
        useDeleteAndLeave({
          confirm,
          remove: async () => {
            removed.push(subject)
          },
          leave,
          subject,
        }),
      { initialProps: { subject: 'first' } },
    )
    const pending: Promise<void>[] = []
    act(() => {
      pending.push(result.current.start('First', ASK))
      pending.push(result.current.start('First', ASK))
    })
    expect(confirm).toHaveBeenCalledTimes(1)
    rerender({ subject: 'second' })
    act(() => {
      pending.push(result.current.start('Second', ASK))
    })
    expect(confirm).toHaveBeenCalledTimes(2)
    await act(async () => {
      answers.forEach((answer) => answer(true))
      await Promise.all(pending)
    })
    expect(removed).toEqual(['second'])
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it('does not leave when the subject changes while the delete runs', async () => {
    const hold = gate()
    const leave = vi.fn()
    const { result, rerender } = renderHook(
      ({ subject }) =>
        useDeleteAndLeave({
          confirm: async () => true,
          remove: () => hold.opened,
          leave,
          subject,
        }),
      { initialProps: { subject: 'a' } },
    )
    let started: Promise<void> = Promise.resolve()
    act(() => {
      started = result.current.start('Angeline', ASK)
    })
    await waitFor(() => expect(result.current.deletingName).toBe('Angeline'))
    rerender({ subject: 'b' })
    expect(result.current.deletingName).toBeNull()
    await act(async () => {
      hold.open()
      await started
    })
    expect(leave).not.toHaveBeenCalled()
  })

  it('asks and deletes again after leaving a subject mid-question and coming back', async () => {
    const removed: string[] = []
    const leave = vi.fn()
    let answer: (ok: boolean) => void = () => {}
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
    )
    const { result, rerender } = renderHook(
      ({ subject }) =>
        useDeleteAndLeave({
          confirm,
          remove: async () => {
            removed.push(subject)
          },
          leave,
          subject,
        }),
      { initialProps: { subject: 'a' } },
    )
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('A', ASK)
    })
    rerender({ subject: 'b' })
    await act(async () => {
      answer(true)
      await first
    })
    rerender({ subject: 'a' })
    let second: Promise<void> = Promise.resolve()
    act(() => {
      second = result.current.start('A', ASK)
    })
    expect(confirm).toHaveBeenCalledTimes(2)
    await act(async () => {
      answer(true)
      await second
    })
    expect(removed).toEqual(['a'])
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it('asks again after a write that failed once the subject had changed', async () => {
    const hold = gate()
    const remove = vi.fn().mockImplementationOnce(async () => {
      await hold.opened
      throw new Error('Refused')
    })
    const onError = vi.fn()
    const leave = vi.fn()
    const { result, rerender } = renderHook(
      ({ subject }) =>
        useDeleteAndLeave({ confirm: async () => true, remove, leave, onError, subject }),
      { initialProps: { subject: 'a' } },
    )
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.start('A', ASK)
    })
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    rerender({ subject: 'b' })
    await act(async () => {
      hold.open()
      await first
    })
    expect(onError).not.toHaveBeenCalled()
    rerender({ subject: 'a' })
    await act(() => result.current.start('A', ASK))
    expect(remove).toHaveBeenCalledTimes(2)
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it('gives the question a signal that aborts when the subject changes', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const { result, rerender } = renderHook(
      ({ subject }) =>
        useDeleteAndLeave({
          confirm: (question) => {
            signals.push(question.signal)
            return new Promise<boolean>(() => {})
          },
          remove: async () => {},
          leave: () => {},
          subject,
        }),
      { initialProps: { subject: 'a' } },
    )
    act(() => {
      void result.current.start('A', ASK)
    })
    expect(signals[0]?.aborted).toBe(false)
    rerender({ subject: 'b' })
    expect(signals[0]?.aborted).toBe(true)
  })
})
