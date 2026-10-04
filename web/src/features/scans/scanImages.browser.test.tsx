import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScanFile } from '../../db/scans'
import { jpegBlob, scanFile } from '../../test/rows'
import { type DecodedImage, useScanImage } from './scanImages'

describe('useScanImage', () => {
  it('revokes the shown URL as soon as the scan has no file', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const file = scanFile('p1', await jpegBlob(60, 80))
    const { result, rerender } = renderHook<DecodedImage, { shown: ScanFile | undefined }>(
      ({ shown }) => useScanImage(shown),
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
