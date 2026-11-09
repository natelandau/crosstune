import { describe, expect, it } from 'vitest'
import { latestSaveQueue } from './latestSaveQueue'

/** A save of `text` that records it, and waits on `hold` first when given one. */
function saver(written: string[], hold?: Promise<void>) {
  return (text: string) => async () => {
    await hold
    written.push(text)
  }
}

describe('latestSaveQueue', () => {
  it('writes only the latest text queued behind a save that is held', async () => {
    const written: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const enqueue = latestSaveQueue()
    const first = enqueue(() => {
      started()
      return saver(written, held)('L')()
    })
    await running
    const second = enqueue(saver(written)('Lo'))
    expect(enqueue(saver(written)('Long bow'))).toBeNull()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    release()
    await second
    expect(written).toEqual(['L', 'Long bow'])
  })

  it('runs a save at once when nothing waits', async () => {
    const written: string[] = []
    const enqueue = latestSaveQueue()
    await enqueue(saver(written)('L'))
    await enqueue(saver(written)('Lo'))
    expect(written).toEqual(['L', 'Lo'])
  })

  it('goes on to the next save after one fails', async () => {
    const written: string[] = []
    const enqueue = latestSaveQueue()
    const failing = enqueue(() => Promise.reject(new Error('offline')))
    await expect(failing).rejects.toThrow('offline')
    await enqueue(saver(written)('Long bow'))
    expect(written).toEqual(['Long bow'])
  })
})
