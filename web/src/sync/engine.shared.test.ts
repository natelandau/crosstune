import { expect } from 'vitest'
import { noopAnalytics } from '../usage/client'
import { openTestDb } from '../test/db'
import {
  createScriptedFetch,
  withCanonicalTimestamps,
  type ScriptedResponse,
  type SentRequest,
} from '../test/scriptedFetch'
import { describeSharedCases, loadSharedCases } from '../test/sharedCases'
import { expectLocalState, seedLocalState, type LocalState } from '../test/syncCases'
import { testApiClient } from '../test/testApiClient'
import { createSyncEngine } from './engine'

type EngineAction = 'sync' | 'pull_events' | 'stop'

interface EngineCaseInput {
  local: LocalState
  batch_size?: number
  responses: ScriptedResponse[]
  actions: EngineAction[]
}

interface EngineCaseExpected {
  requests: SentRequest[]
  local: LocalState
}

const cases = loadSharedCases<EngineCaseInput, EngineCaseExpected>(
  import.meta.glob('../../../fixtures/sync-engine/*.json', { eager: true, import: 'default' }),
  'web',
)

describeSharedCases('sync engine shared cases', cases, 9, async ({ input, expected }) => {
  const db = openTestDb()
  await seedLocalState(db, input.local)
  const server = createScriptedFetch(input.responses)
  const api = testApiClient(server.fetch, { gatewayRetryDelaysMs: [] })
  const engine = createSyncEngine({
    analytics: noopAnalytics,
    db,
    api,
    isOnline: () => true,
    batchSize: input.batch_size,
    onInvalid: () => {},
  })

  const runs: Promise<void>[] = []
  for (const action of input.actions) {
    if (action === 'sync') runs.push(engine.sync())
    else if (action === 'pull_events') runs.push(engine.pullEvents())
    else server.onNextResponse(() => engine.stop())
  }
  await Promise.allSettled(runs)
  // A sync run starts the file transfer loop; let it finish before the database closes.
  await engine.transfer()
  engine.stop()

  expect(server.unexpected, 'requests the script did not expect').toEqual([])
  expect(server.remaining(), 'scripted responses no request took').toBe(0)
  expect(withCanonicalTimestamps(server.sent)).toEqual(withCanonicalTimestamps(expected.requests))
  await expectLocalState(db, expected.local)
})
