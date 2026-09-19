import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePendingWrite } from './usePendingWrite'

interface Row {
  a: number
  b: number
}

interface Call {
  patch: Partial<Row>
  resolve: () => void
  reject: (error: Error) => void
}

function setup(initial: Row | null = { a: 1, b: 1 }) {
  const calls: Call[] = []
  const write = (patch: Partial<Row>) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ patch, resolve, reject })
    })
  const hook = renderHook(({ stored }) => usePendingWrite<Row>(stored, write), {
    initialProps: { stored: initial ?? (undefined as Row | undefined) },
  })
  const settle = async (fn: () => void) => {
    await act(async () => {
      fn()
      await Promise.resolve()
    })
  }
  const flush = () => act(async () => {})
  const call = (index: number) => {
    const found = calls[index]
    if (!found) throw new Error(`no write ${index} yet`)
    return found
  }
  return { ...hook, calls, call, settle, flush }
}

describe('usePendingWrite', () => {
  it('shows the stored value when nothing is being written', () => {
    const stored = { a: 1, b: 1 }
    const { result } = setup(stored)
    expect(result.current[0]).toBe(stored)
  })

  it('shows quick successive patches at once and writes them one after another', async () => {
    const { result, calls, call, rerender, settle, flush } = setup()
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current[1]({ a: 2 })
    })
    act(() => {
      second = result.current[1]({ b: 3 })
    })
    expect(result.current[0]).toEqual({ a: 2, b: 3 })
    await flush()
    expect(calls.map((call) => call.patch)).toEqual([{ a: 2 }])

    await settle(() => call(0).resolve())
    await first
    await flush()
    expect(calls.map((call) => call.patch)).toEqual([{ a: 2 }, { b: 3 }])
    expect(result.current[0]).toEqual({ a: 2, b: 3 })

    await settle(() => call(1).resolve())
    await second
    const final = { a: 2, b: 3 }
    rerender({ stored: final })
    expect(result.current[0]).toBe(final)
  })

  it('keeps the patch showing after its write settles until the next read', async () => {
    const { result, call, settle, flush } = setup()
    act(() => void result.current[1]({ a: 2 }))
    await flush()
    await settle(() => call(0).resolve())
    expect(result.current[0]).toEqual({ a: 2, b: 1 })
  })

  it('follows a synced value that arrives after the write settles', async () => {
    const { result, call, rerender, settle, flush } = setup()
    act(() => void result.current[1]({ a: 2 }))
    await flush()
    await settle(() => call(0).resolve())
    const synced = { a: 3, b: 1 }
    rerender({ stored: synced })
    expect(result.current[0]).toBe(synced)
  })

  it('reverts only a failed write while a later write is still in flight', async () => {
    const { result, call, settle, flush } = setup()
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current[1]({ a: 2 })
      second = result.current[1]({ a: 3 })
    })
    first.catch(() => {})
    second.catch(() => {})
    await flush()

    await settle(() => call(0).reject(new Error('first')))
    await expect(first).rejects.toThrow('first')
    expect(result.current[0]).toEqual({ a: 3, b: 1 })

    await flush()
    await settle(() => call(1).reject(new Error('second')))
    await expect(second).rejects.toThrow('second')
    expect(result.current[0]).toEqual({ a: 1, b: 1 })
  })

  it('shows the last of two patches made in the same tick and writes both in order', async () => {
    const { result, calls, call, rerender, settle, flush } = setup()
    act(() => {
      void result.current[1]({ a: 2 })
      void result.current[1]({ a: 3 })
    })
    expect(result.current[0]).toEqual({ a: 3, b: 1 })
    await flush()
    await settle(() => call(0).resolve())
    await flush()
    expect(calls.map((call) => call.patch)).toEqual([{ a: 2 }, { a: 3 }])
    expect(result.current[0]).toEqual({ a: 3, b: 1 })
    await settle(() => call(1).resolve())
    const stored = { a: 3, b: 1 }
    rerender({ stored })
    expect(result.current[0]).toBe(stored)
  })

  it('clears the patch when the read of its own write lands in the same tick it settles', async () => {
    const { result, call, rerender, flush } = setup()
    act(() => void result.current[1]({ a: 2 }))
    await flush()
    const written = { a: 2, b: 1 }
    await act(async () => {
      call(0).resolve()
      rerender({ stored: written })
      await Promise.resolve()
    })
    await flush()
    expect(result.current[0]).toBe(written)
  })

  it('lets the next read decide when nothing was stored while the write ran', async () => {
    const { result, call, rerender, settle, flush } = setup(null)
    act(() => void result.current[1]({ a: 2 }))
    expect(result.current[0]).toBeUndefined()
    await flush()
    await settle(() => call(0).resolve())
    const stored = { a: 5, b: 1 }
    rerender({ stored })
    expect(result.current[0]).toBe(stored)
  })
})
