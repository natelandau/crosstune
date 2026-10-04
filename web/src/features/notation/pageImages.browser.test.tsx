import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NotationFile } from '../../db/notation'
import { jpegBlob, notationFile } from '../../test/rows'
import { type PageImage, usePageImage } from './pageImages'

describe('usePageImage', () => {
  it('revokes the shown URL as soon as the page has no file', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const file = notationFile('p1', await jpegBlob(60, 80))
    const { result, rerender } = renderHook<PageImage, { shown: NotationFile | undefined }>(
      ({ shown }) => usePageImage(shown),
      { initialProps: { shown: file } },
    )
    await expect.poll(() => result.current.kind).toBe('ready')
    const shown = result.current
    const url = shown.kind === 'ready' ? shown.url : ''
    rerender({ shown: undefined })
    await expect.poll(() => revoke.mock.calls.some(([revoked]) => revoked === url)).toBe(true)
    expect(result.current.kind).toBe('loading')
  })
})
