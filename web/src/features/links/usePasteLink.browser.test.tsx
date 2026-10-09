import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { recordingAnalytics } from '../../analytics/testing'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { LINK_NOT_WEB, LINK_REQUIRED } from './pasteLinkCopy'
import { usePasteLink } from './usePasteLink'

let db: CrosstuneDb
let tuneId: string

beforeEach(async () => {
  db = openTestDb()
  ;({ tuneId } = await createTune(db, { title: 'Reel' }, { status: 'known' }))
})

function setup(analytics = recordingAnalytics()) {
  const onClose = vi.fn()
  const onInvalid = vi.fn()
  const hook = renderHook(
    ({ target }: { target: string | null }) => usePasteLink(target, { onClose, onInvalid }),
    {
      wrapper: dataProviders({ db, analytics }),
      initialProps: { target: tuneId as string | null },
    },
  )
  return { ...hook, onClose, onInvalid, analytics }
}

describe('usePasteLink', () => {
  it('opens empty', () => {
    const { result } = setup()
    expect(result.current.open).toBe(true)
    expect(result.current.url).toBe('')
    expect(result.current.validation).toBeNull()
  })

  it('refuses a blank link and an address that is not on the web, adding nothing', async () => {
    const { result, onInvalid } = setup()
    act(() => result.current.submit())
    expect(result.current.validation).toBe(LINK_REQUIRED)
    act(() => result.current.setUrl('ftp://example.com/tune'))
    expect(result.current.validation).toBeNull()
    act(() => result.current.submit())
    expect(result.current.validation).toBe(LINK_NOT_WEB)
    expect(onInvalid).toHaveBeenCalledTimes(2)
    expect(result.current.closing).toBe(false)
    expect(await db.recording_links.count()).toBe(0)
  })

  it('adds the link once, then closes and reports the close once dismissed', async () => {
    const { result, onClose } = setup()
    act(() => result.current.setUrl('  https://youtu.be/dQw4w9WgXcQ  '))
    act(() => {
      result.current.submit()
      result.current.submit()
    })
    await expect.poll(() => result.current.closing).toBe(true)
    expect(result.current.open).toBe(false)
    const links = await db.recording_links.toArray()
    expect(links.map((link) => [link.url, link.provider])).toEqual([
      ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ])
    expect(onClose).not.toHaveBeenCalled()
    act(() => result.current.dismissed())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('starts clean when it opens again', () => {
    const { result, rerender } = setup()
    act(() => result.current.setUrl('https://example.com'))
    act(() => result.current.close())
    act(() => result.current.dismissed())
    rerender({ target: null })
    rerender({ target: tuneId })
    expect(result.current.open).toBe(true)
    expect(result.current.url).toBe('')
  })

  it('reports the pasted link with its service and ids once it is saved', async () => {
    const { result, analytics } = setup()
    act(() => result.current.setUrl('https://youtu.be/dQw4w9WgXcQ'))
    act(() => result.current.submit())
    await expect.poll(() => analytics.sends()).toHaveLength(1)
    const [link] = await db.recording_links.toArray()
    expect(analytics.sends()).toEqual([
      {
        name: 'link_added',
        props: { service: 'youtube', via: 'paste', link_id: link!.id, tune_id: tuneId },
      },
    ])
  })

  it('reports nothing for a link that was refused', async () => {
    const { result, analytics } = setup()
    act(() => result.current.submit())
    await expect.poll(() => result.current.validation).toBe(LINK_REQUIRED)
    expect(analytics.sends()).toEqual([])
  })
})
