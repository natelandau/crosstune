import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlayer } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { DELETE } from '../../ui/confirmCopy'
import { PlayerContext } from '../player/usePlayer'
import { TRIM } from '../practice/trimCopy'
import { EDIT, openOn, ADD_TO_TUNE } from './recordingCopy'
import { GO_TO_TUNE } from './recordingNames'
import type { RecordingView } from './useRecordings'
import {
  REMOVE_FROM_TUNE,
  useRecordingActionsWith,
  type RecordingActionsOptions,
} from './useRecordingActionsWith'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function view(overrides: Partial<RecordingView> & { origin_url?: string | null } = {}) {
  const { origin_url = null, ...rest } = overrides
  return {
    recording: recordingRow('r1', {
      label: 'Jam recording',
      origin: origin_url ? 'slippery_hill' : 'own',
      origin_url,
    }),
    file: undefined,
    tuneId: null,
    tuneTitle: null,
    ...rest,
  } satisfies RecordingView
}

function setup(options: RecordingActionsOptions = {}) {
  const Data = dataProviders({ db })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={fakePlayer()}>{children}</PlayerContext.Provider>
    </Data>
  )
  const confirm = vi.fn(async () => false)
  return renderHook(() => useRecordingActionsWith({ confirm, ...options }), { wrapper }).result
}

const labels = (items: { label: string }[]) => items.map((item) => item.label)

describe('useRecordingActionsWith', () => {
  it('offers Trim first, only in the menu', () => {
    const result = setup({ onEdit: () => {}, onTrim: () => {}, onAddToTune: () => {} })
    expect(labels(result.current.menuFor(view()))).toEqual([TRIM, EDIT, ADD_TO_TUNE, DELETE])
    expect(labels(result.current.actionsFor(view()))).not.toContain(TRIM)
    expect(result.current.menuFor(view())[0]).toMatchObject({ disabled: undefined })
  })

  it('shows Trim disabled with its reason while it is blocked', () => {
    const result = setup({ onTrim: () => {}, trimBlocked: 'Offline' })
    expect(result.current.menuFor(view())[0]).toMatchObject({ label: TRIM, disabled: 'Offline' })
  })

  it('offers Open on the site only for an import whose page is http or https', () => {
    const result = setup()
    const page = 'https://www.slippery-hill.com/content/x'
    expect(labels(result.current.menuFor(view({ origin_url: page })))).toContain(
      openOn('Slippery-Hill'),
    )
    for (const url of ['javascript:alert(1)', 'garbage', null]) {
      expect(labels(result.current.menuFor(view({ origin_url: url })))).not.toContain(
        openOn('Slippery-Hill'),
      )
    }
  })

  it('offers Go to tune after Remove from tune, on a filed view with a handler only', () => {
    const filed = view({ tuneId: 't1', tuneTitle: 'Cluck Old Hen' })
    const withHandler = setup({ onOpenTune: () => {} })
    expect(labels(withHandler.current.menuFor(filed))).toEqual([
      REMOVE_FROM_TUNE,
      GO_TO_TUNE,
      DELETE,
    ])
    expect(labels(withHandler.current.menuFor(view()))).not.toContain(GO_TO_TUNE)
    expect(labels(setup().current.menuFor(filed))).not.toContain(GO_TO_TUNE)
  })
})
