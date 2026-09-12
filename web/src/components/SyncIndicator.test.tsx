import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SyncIndicator } from './SyncIndicator'

let status = 'idle'
let lastSyncedAt: string | null = null
vi.mock('../sync/SyncProvider', () => ({
  useSyncStatus: () => status,
  useLastSyncedAt: () => lastSyncedAt,
}))

describe('SyncIndicator', () => {
  it('labels each status', () => {
    const { rerender } = render(<SyncIndicator />)
    expect(screen.getByRole('status')).toHaveAttribute('data-status', 'idle')
    expect(screen.getByRole('status')).toHaveAccessibleName('Synced')
    status = 'offline'
    rerender(<SyncIndicator />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Offline')
    status = 'unauthorized'
    rerender(<SyncIndicator />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Sign in again')
  })

  it('publishes the last clean run so a waiting client can tell cycles apart', () => {
    status = 'idle'
    const { rerender } = render(<SyncIndicator />)
    expect(screen.getByRole('status')).toHaveAttribute('data-synced-at', '')
    lastSyncedAt = '2026-09-11T10:00:00.000Z'
    rerender(<SyncIndicator />)
    expect(screen.getByRole('status')).toHaveAttribute('data-synced-at', '2026-09-11T10:00:00.000Z')
  })
})
