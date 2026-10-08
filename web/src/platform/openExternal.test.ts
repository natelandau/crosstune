import { describe, expect, it, vi } from 'vitest'
import { openExternal } from './openExternal'

describe('openExternal', () => {
  it('opens the page in a new tab that cannot reach back into this one', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    openExternal('https://example.com/tune')

    expect(open).toHaveBeenCalledWith('https://example.com/tune', '_blank', 'noopener,noreferrer')
  })
})
