import { page } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { fakePlaybackEngine } from '../../test/providers'
import { RowList } from '../../ui/RowList'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import {
  ListPlaybackContext,
  type ListPlayback,
  type ListPlaybackActive,
} from '../player/useListPlayback'
import { playListName } from './listPlayCopy'
import { ListRow } from './ListRow'
import type { ListSummary } from './useLists'

const AT = '2026-01-01T00:00:00.000Z'
const LIST: ListSummary = {
  id: 'l1',
  name: 'Thursday jam',
  position: 0,
  created_at: AT,
  updated_at: AT,
  deleted_at: null,
  server_seq: 0,
  count: 3,
  lastEditedAt: AT,
}

function playback(active: Partial<ListPlaybackActive>): ListPlayback {
  return {
    active: {
      listId: 'l1',
      listName: 'Thursday jam',
      position: 2,
      count: 3,
      shuffled: false,
      repeat: 'off',
      message: null,
      settled: true,
      ...active,
    },
    start: vi.fn(),
    jump: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    toggleShuffle: vi.fn(),
    cycleRepeat: vi.fn(),
    end: vi.fn(),
  }
}

function mount(value: ListPlayback) {
  renderWithProviders(
    <PlaybackEngineContext.Provider value={fakePlaybackEngine()}>
      <ListPlaybackContext.Provider value={value}>
        <RowList label="Lists">
          <ListRow list={LIST} playable onPlay={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />
        </RowList>
      </ListPlaybackContext.Provider>
    </PlaybackEngineContext.Provider>,
    { density: 'touch' },
  )
}

it('holds the playing list control while the next tune loads', async () => {
  mount(playback({ settled: false }))
  await expect.element(page.getByRole('button', { name: playListName(LIST.name) })).toBeDisabled()
})

it('lets the playing list control act once its tune has loaded', async () => {
  mount(playback({ settled: true }))
  await expect.element(page.getByRole('button', { name: playListName(LIST.name) })).toBeEnabled()
})
