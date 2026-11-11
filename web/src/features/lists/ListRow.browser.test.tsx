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

function idle(): ListPlayback {
  return { ...playback({}), active: null }
}

function mount(value: ListPlayback, density: 'pointer' | 'touch' = 'touch') {
  const engine = fakePlaybackEngine()
  const play = vi.spyOn(engine, 'play')
  const onPlay = vi.fn()
  renderWithProviders(
    <PlaybackEngineContext.Provider value={engine}>
      <ListPlaybackContext.Provider value={value}>
        <RowList label="Lists">
          <ListRow list={LIST} playable onPlay={onPlay} onRename={vi.fn()} onDelete={vi.fn()} />
        </RowList>
      </ListPlaybackContext.Provider>
    </PlaybackEngineContext.Provider>,
    { density },
  )
  return { play, onPlay }
}

it.each(['pointer', 'touch'] as const)(
  'offers no play button on a list that is not playing, on %s',
  async (density) => {
    mount(idle(), density)
    await expect.element(page.getByRole('row', { name: /Thursday jam/ })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: playListName(LIST.name) }))
      .not.toBeInTheDocument()
  },
)

it('resumes, not restarts, the paused playing list', async () => {
  const { play, onPlay } = mount(playback({ settled: true }))
  const control = page.getByRole('button', { name: playListName(LIST.name) })
  await expect.element(control).toBeEnabled()
  await control.click()
  await expect.poll(() => play.mock.calls.length).toBe(1)
  expect(onPlay).not.toHaveBeenCalled()
})

it('holds the playing list control while the next tune loads', async () => {
  mount(playback({ settled: false }))
  await expect.element(page.getByRole('button', { name: playListName(LIST.name) })).toBeDisabled()
})

it('lets the playing list control act once its tune has loaded', async () => {
  mount(playback({ settled: true }))
  await expect.element(page.getByRole('button', { name: playListName(LIST.name) })).toBeEnabled()
})
