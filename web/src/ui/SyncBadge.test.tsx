import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNC_STATUS_LABELS } from '../sync/labels'
import { SyncBadge } from './SyncBadge'
import type { SyncStatus } from '../sync/types'

let status: SyncStatus = 'idle'
let lastSyncedAt: string | null = null

vi.mock('../sync/SyncProvider', () => ({
  useSyncStatus: () => status,
  useLastSyncedAt: () => lastSyncedAt,
}))

beforeEach(() => {
  status = 'idle'
  lastSyncedAt = null
})

describe('SyncBadge', () => {
  it('says nothing when the last run was clean', () => {
    render(<SyncBadge />)
    expect(screen.getByTestId('sync-status')).toHaveTextContent('')
  })

  it('says nothing while a run is in flight', () => {
    status = 'syncing'
    render(<SyncBadge />)
    expect(screen.getByTestId('sync-status')).toHaveTextContent('')
  })

  it('names each state that needs attention', () => {
    for (const [state, label] of [
      ['offline', SYNC_STATUS_LABELS.offline],
      ['unauthorized', SYNC_STATUS_LABELS.unauthorized],
      ['error', SYNC_STATUS_LABELS.error],
    ] as const) {
      status = state
      const { unmount } = render(<SyncBadge />)
      expect(screen.getByText(label)).toBeVisible()
      // A live region announces its contents, so a name as well would say it twice.
      expect(screen.getByRole('status')).not.toHaveAttribute('aria-label')
      unmount()
    }
  })

  it('reports the status and the last clean run for the e2e suite', () => {
    const { rerender } = render(<SyncBadge />)
    expect(screen.getByTestId('sync-status')).toHaveAttribute('data-status', 'idle')
    expect(screen.getByTestId('sync-status')).toHaveAttribute('data-synced-at', '')
    lastSyncedAt = '2026-09-18T00:00:00.000Z'
    rerender(<SyncBadge />)
    expect(screen.getByTestId('sync-status')).toHaveAttribute(
      'data-synced-at',
      '2026-09-18T00:00:00.000Z',
    )
  })
})
