import { render } from '@testing-library/react'
import { describe, expect, it, onTestFinished } from 'vitest'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import type { AnalyticsClient } from '../../usage/client'
import { recordingAnalytics } from '../../usage/testing'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { fakePlaybackEngine, FakeAudioElement } from '../../test/providers'
import { linkRow, recordingRow } from '../../test/rows'
import { usePracticeLog } from '../practice/usePracticeLog'
import type { HeldSettings } from '../practice/usePracticeOverlay'
import { PlaybackEngineContext } from './PlaybackEngineProvider'
import type { EngineClock, PlaybackEngine } from './playbackEngine'
import type { PlayOrigin } from './playLog'
import { PlayLogContext, usePlayLog } from './usePlayLog'
import type { PlayerItem } from '../../domain/playerItem'

// The engine's own ticks only move the reported position, which no log reads.
const stillClock: EngineClock = { every: () => () => {}, after: () => () => {} }
const SPAN = { fromS: 0, toS: 60, lengthMs: 60_000 }
const REC: PlayerItem = { kind: 'recording', id: 'rec-1' }

function setup() {
  const db = openTestDb()
  const element = new FakeAudioElement()
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement, stillClock)
  onTestFinished(() => engine.dispose())
  let t = Date.parse('2026-03-01T12:00:00.000Z')
  const now = () => t
  const advance = (ms: number) => {
    t += ms
  }
  return { db, element, engine, now, advance }
}

/** Puts the page behind another tab or app, as the browser reports it. */
function hidePage() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  onTestFinished(showPage)
  document.dispatchEvent(new Event('visibilitychange'))
}

function showPage() {
  // The own property shadows the document's real getter; deleting it restores that.
  delete (document as { visibilityState?: unknown }).visibilityState
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Every play's context and length, and the number of practice sessions, read together. */
async function written(db: CrosstuneDb) {
  const plays = await db.play_events.orderBy('id').toArray()
  return {
    plays: plays.map((p) => [p.context, p.listened_ms]),
    practice: await db.practice_sessions.count(),
  }
}

/** Practice's hold, as its provider keeps it, for a test to set. */
function fakeOverlay() {
  const holds = new Map<string, HeldSettings>()
  const listeners = new Set<() => void>()
  return {
    held: (id: string) => holds.get(id) ?? null,
    hold: (id: string, settings: HeldSettings | null) => {
      if (settings) holds.set(id, settings)
      else holds.delete(id)
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function Practice({
  id,
  overlay,
  now,
}: {
  id: string | null
  overlay: ReturnType<typeof fakeOverlay>
  now: () => number
}) {
  usePracticeLog(id, overlay, { now })
  return null
}

interface HarnessProps {
  item: PlayerItem | null
  origin?: PlayOrigin
  overlayId?: string | null
}

function harness(
  db: CrosstuneDb,
  engine: PlaybackEngine,
  now: () => number,
  initial: HarnessProps,
  analytics?: AnalyticsClient,
) {
  const overlay = fakeOverlay()
  function Harness({ item, origin = { context: 'row' }, overlayId = null }: HarnessProps) {
    const control = usePlayLog(engine, item, origin, { now })
    return (
      <PlayLogContext.Provider value={control}>
        <Practice id={overlayId} overlay={overlay} now={now} />
      </PlayLogContext.Provider>
    )
  }
  const tree = (props: HarnessProps) => {
    const inner = (
      <DbContext.Provider value={db}>
        <PlaybackEngineContext.Provider value={engine}>
          <Harness {...props} />
        </PlaybackEngineContext.Provider>
      </DbContext.Provider>
    )
    return analytics ? <AnalyticsProvider client={analytics}>{inner}</AnalyticsProvider> : inner
  }
  const view = render(tree(initial))
  return { overlay, rerender: (props: HarnessProps) => view.rerender(tree(props)) }
}

const SETTINGS = { speedPercent: 100, pitchCents: 0 }
const META = { title: 'Reel' }

function loadAndPlay(engine: PlaybackEngine) {
  engine.load('blob:rec-1', SPAN, SETTINGS, META)
  engine.play()
}

describe('usePlayLog', () => {
  it('a played recording lands in play_events', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1', { tune_id: 'tune-1' }))
    const { rerender } = harness(db, engine, now, {
      item: REC,
      origin: { context: 'list', listId: 'list-1' },
    })
    loadAndPlay(engine)
    advance(12_000)
    engine.pause()
    rerender({ item: null })

    await expect
      .poll(() => db.play_events.toArray())
      .toEqual([
        expect.objectContaining({
          recording_id: 'rec-1',
          tune_id: 'tune-1',
          link_id: null,
          context: 'list',
          list_id: 'list-1',
          started_at: '2026-03-01T12:00:00.000Z',
          listened_ms: 12_000,
        }),
      ])
    await expect.poll(() => db.outbox.count()).toBe(1)
  })

  it('flushes an open play on page hide', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    harness(db, engine, now, { item: REC })
    loadAndPlay(engine)
    advance(15_000)
    window.dispatchEvent(new PageTransitionEvent('pagehide'))

    await expect
      .poll(() => db.play_events.toArray())
      .toEqual([
        expect.objectContaining({ recording_id: 'rec-1', context: 'row', listened_ms: 15_000 }),
      ])
  })

  it('a recording played to its end and replayed is two plays', async () => {
    const { db, element, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const { rerender } = harness(db, engine, now, { item: REC })
    loadAndPlay(engine)
    advance(60_000)
    element.paused = true
    element.dispatchEvent(new Event('ended'))
    engine.play()
    advance(12_000)
    engine.pause()
    rerender({ item: null })

    await expect
      .poll(() => written(db))
      .toEqual({
        plays: [
          ['row', 60_000],
          ['row', 12_000],
        ],
        practice: 0,
      })
  })

  it("a new recording's play never takes the outgoing recording's length", async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.bulkPut([
      recordingRow('rec-1'),
      recordingRow('rec-2'),
      recordingRow('rec-3'),
    ])
    const { rerender } = harness(db, engine, now, { item: REC })
    engine.load('blob:rec-1', { fromS: 0, toS: 4, lengthMs: 4_000 }, SETTINGS, META)
    engine.play()
    advance(1_000)
    rerender({ item: { kind: 'recording', id: 'rec-2' } })
    // Still loaded, the outgoing recording reports its 4 s length once more.
    engine.pause()
    engine.unload()
    // A length the engine learns only from the media, which this one never reports.
    engine.load('blob:rec-2', { fromS: 0, toS: Infinity, lengthMs: 0 }, SETTINGS, META)
    engine.play()
    advance(5_000)
    engine.pause()
    // Under the full ten seconds an unknown length needs; 4 s would have let it through.
    rerender({ item: { kind: 'recording', id: 'rec-3' } })
    engine.unload()
    engine.load('blob:rec-3', SPAN, SETTINGS, META)
    engine.play()
    advance(12_000)
    engine.pause()
    rerender({ item: null })

    await expect
      .poll(async () =>
        (await db.play_events.orderBy('id').toArray()).map((p) => [p.recording_id, p.listened_ms]),
      )
      .toEqual([['rec-3', 12_000]])
  })

  it('a short recording heard whole above normal speed is a play', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const { rerender } = harness(db, engine, now, { item: REC })
    engine.load(
      'blob:rec-1',
      { fromS: 0, toS: 6, lengthMs: 6_000 },
      { speedPercent: 150, pitchCents: 0 },
      META,
    )
    engine.play()
    advance(4_000)
    engine.pause()
    rerender({ item: null })

    await expect.poll(() => written(db)).toEqual({ plays: [['row', 4_000]], practice: 0 })
  })

  it('a tab hidden while playing keeps one play', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const { rerender } = harness(db, engine, now, { item: REC })
    loadAndPlay(engine)
    advance(8_000)
    hidePage()
    advance(8_000)
    showPage()
    advance(8_000)
    engine.pause()
    rerender({ item: null })

    await expect.poll(() => written(db)).toEqual({ plays: [['row', 24_000]], practice: 0 })
  })

  it('a tab hidden while paused flushes the play', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    harness(db, engine, now, { item: REC })
    loadAndPlay(engine)
    advance(12_000)
    engine.pause()
    hidePage()

    await expect.poll(() => written(db)).toEqual({ plays: [['row', 12_000]], practice: 0 })
  })

  it('a practice visit that plays a loop is practice, not a play', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1', { tune_id: 'tune-1' }))
    const { rerender } = harness(db, engine, now, { item: REC })
    loadAndPlay(engine)
    advance(4_000)
    rerender({ item: REC, overlayId: 'rec-1' })
    engine.setLoop({ id: 'loop-1', label: 'B part', fromS: 10, toS: 20 })
    engine.setRepeat(true)
    advance(14_000)
    rerender({ item: REC, overlayId: null })
    engine.pause()
    // A dock play after the visit, so a wrong play from the visit would be written before it.
    engine.play()
    advance(11_000)
    engine.pause()
    rerender({ item: null })

    await expect.poll(() => written(db)).toEqual({ plays: [['dock', 11_000]], practice: 1 })
    await expect
      .poll(() => db.practice_sessions.toArray())
      .toEqual([
        expect.objectContaining({
          recording_id: 'rec-1',
          tune_id: 'tune-1',
          duration_ms: 14_000,
          loop_ids: ['loop-1'],
          speed_percent: 100,
          pitch_cents: 0,
        }),
      ])
  })

  it('a practice visit at the default settings is a play from practice', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const { rerender } = harness(db, engine, now, { item: REC, overlayId: 'rec-1' })
    loadAndPlay(engine)
    advance(20_000)
    engine.pause()
    rerender({ item: REC, overlayId: null })

    await expect
      .poll(() => written(db))
      .toEqual({ plays: [['recording_screen', 20_000]], practice: 0 })
  })

  it('a tab hidden while practice plays keeps one visit', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const { rerender } = harness(db, engine, now, { item: REC, overlayId: 'rec-1' })
    loadAndPlay(engine)
    advance(8_000)
    hidePage()
    advance(8_000)
    showPage()
    engine.pause()
    rerender({ item: REC, overlayId: null })

    await expect
      .poll(() => written(db))
      .toEqual({ plays: [['recording_screen', 16_000]], practice: 0 })
  })

  it('a tab hidden while practice is paused ends the visit', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    harness(db, engine, now, { item: REC, overlayId: 'rec-1' })
    loadAndPlay(engine)
    advance(12_000)
    engine.pause()
    hidePage()

    await expect
      .poll(() => written(db))
      .toEqual({ plays: [['recording_screen', 12_000]], practice: 0 })
  })

  it("another recording playing while practice shows counts toward neither's visit", async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.bulkPut([recordingRow('rec-1'), recordingRow('rec-2')])
    const { rerender } = harness(db, engine, now, { item: REC })
    engine.load('blob:rec-1', SPAN, { speedPercent: 80, pitchCents: 0 }, META)
    engine.play()
    advance(4_000)
    rerender({ item: REC, overlayId: 'rec-2' })
    // A pause and resume from the lock screen, while rec-1 is still the one loaded.
    engine.pause()
    engine.play()
    advance(20_000)
    engine.pause()
    rerender({ item: REC, overlayId: null })
    rerender({ item: null })

    await expect.poll(() => written(db)).toEqual({ plays: [], practice: 0 })
  })

  it('time in the trim view at the default settings counts toward no play', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const { overlay, rerender } = harness(db, engine, now, { item: REC, overlayId: 'rec-1' })
    loadAndPlay(engine)
    advance(4_000)
    overlay.hold('rec-1', { ...SETTINGS, trimming: true })
    advance(20_000)
    overlay.hold('rec-1', null)
    engine.pause()
    rerender({ item: REC, overlayId: null })
    // Playing on in the dock afterward is a play of its own, written after the visit's outcome.
    engine.play()
    advance(11_000)
    engine.pause()
    rerender({ item: null })

    await expect.poll(() => written(db)).toEqual({ plays: [['dock', 11_000]], practice: 0 })
  })
})

/** Stands in for the browser's media session, so a test can press its lock-screen controls. */
function fakeMediaSession() {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>()
  const session = {
    metadata: null,
    setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      if (handler) handlers.set(action, handler)
      else handlers.delete(action)
    },
    setPositionState: () => {},
  } as unknown as MediaSession
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true })
  // The own property shadows the browser's; deleting it restores that.
  onTestFinished(() => void Reflect.deleteProperty(navigator, 'mediaSession'))
  return (action: MediaSessionAction) => handlers.get(action)?.({ action })
}

const TUNE_ROW: PlayOrigin = {
  context: 'row',
  report: { source: 'tune', queue: 'single', trigger: 'tap' },
}
const LIST_ROW: PlayOrigin = {
  context: 'list',
  listId: 'list-1',
  report: { source: 'list', queue: 'single', trigger: 'tap' },
}

/** Each playback report's recording or link, how it ended, and whether the system drove it. */
function ends(analytics: ReturnType<typeof recordingAnalytics>) {
  return analytics
    .sends()
    .filter((send) => send.name === 'playback_ended')
    .map(({ props }) => {
      const p = props as Record<string, unknown>
      return [p.recording_id ?? p.link_id, p.ended_by, p.system_controlled]
    })
}

describe('usePlayLog reports', () => {
  it('reports a tune row play with its kind, tune, and listened time', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1', { tune_id: 'tune-1', source: 'upload' }))
    const analytics = recordingAnalytics()
    const { rerender } = harness(db, engine, now, { item: REC, origin: TUNE_ROW }, analytics)
    loadAndPlay(engine)
    advance(3_000)
    engine.pause()
    rerender({ item: null, origin: TUNE_ROW })

    await expect
      .poll(() => analytics.sends())
      .toEqual([
        {
          name: 'playback_ended',
          props: {
            source: 'tune',
            queue: 'single',
            trigger: 'tap',
            kind: 'imported',
            listened_bucket: '<10s',
            completed: false,
            ended_by: 'closed',
            system_controlled: false,
            tune_id: 'tune-1',
            recording_id: 'rec-1',
          },
        },
      ])
    // Under the threshold, so nothing is written.
    expect(await db.play_events.count()).toBe(0)
  })

  it('ended_by is skipped on item change, closed on close, finished at the end', async () => {
    const { db, element, engine, now, advance } = setup()
    await db.recordings.bulkPut([recordingRow('rec-1'), recordingRow('rec-2')])
    const analytics = recordingAnalytics()
    const { rerender } = harness(db, engine, now, { item: REC, origin: TUNE_ROW }, analytics)
    loadAndPlay(engine)
    advance(60_000)
    element.paused = true
    element.dispatchEvent(new Event('ended'))
    await expect.poll(() => ends(analytics)).toEqual([['rec-1', 'finished', false]])
    engine.play()
    advance(2_000)
    rerender({ item: { kind: 'recording', id: 'rec-2' }, origin: TUNE_ROW })
    await expect.poll(() => ends(analytics)).toHaveLength(2)
    engine.load('blob:rec-2', SPAN, SETTINGS, META)
    engine.play()
    advance(1_000)
    rerender({ item: null, origin: TUNE_ROW })

    await expect
      .poll(() => ends(analytics))
      .toEqual([
        ['rec-1', 'finished', false],
        ['rec-1', 'skipped', false],
        ['rec-2', 'closed', false],
      ])
  })

  it('a media session pause marks the play system controlled', async () => {
    const press = fakeMediaSession()
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const analytics = recordingAnalytics()
    const { rerender } = harness(db, engine, now, { item: REC, origin: TUNE_ROW }, analytics)
    loadAndPlay(engine)
    advance(5_000)
    press('pause')
    await expect.poll(() => engine.getState().playing).toBe(false)
    rerender({ item: null, origin: TUNE_ROW })

    await expect.poll(() => ends(analytics)).toEqual([['rec-1', 'closed', true]])
  })

  it('an in-app pause leaves it false', async () => {
    fakeMediaSession()
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const analytics = recordingAnalytics()
    const { rerender } = harness(db, engine, now, { item: REC, origin: TUNE_ROW }, analytics)
    loadAndPlay(engine)
    advance(5_000)
    engine.pause()
    rerender({ item: null, origin: TUNE_ROW })

    await expect.poll(() => ends(analytics)).toEqual([['rec-1', 'closed', false]])
  })

  it('a link play from a list row reports no listened or completed', async () => {
    const { db, engine, now } = setup()
    await db.recording_links.put(linkRow('link-1', 'tune-1', { provider: 'youtube' }))
    await db.recordings.put(recordingRow('rec-1'))
    const analytics = recordingAnalytics()
    const LINK: PlayerItem = { kind: 'link', id: 'link-1' }
    const { rerender } = harness(db, engine, now, { item: LINK, origin: LIST_ROW }, analytics)
    rerender({ item: REC, origin: TUNE_ROW })
    await expect.poll(() => ends(analytics)).toHaveLength(1)
    rerender({ item: LINK, origin: LIST_ROW })
    rerender({ item: null, origin: TUNE_ROW })

    const report = {
      source: 'list',
      queue: 'single',
      trigger: 'tap',
      kind: 'link',
      service: 'youtube',
      system_controlled: false,
      tune_id: 'tune-1',
      link_id: 'link-1',
      list_id: 'list-1',
    }
    await expect
      .poll(() => analytics.sends())
      .toEqual([
        { name: 'playback_ended', props: { ...report, ended_by: 'skipped' } },
        { name: 'playback_ended', props: { ...report, ended_by: 'closed' } },
      ])
  })

  it('a plain practice visit sends only its play from practice', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1', { tune_id: 'tune-1' }))
    const analytics = recordingAnalytics()
    const { rerender } = harness(
      db,
      engine,
      now,
      { item: REC, origin: TUNE_ROW, overlayId: 'rec-1' },
      analytics,
    )
    loadAndPlay(engine)
    advance(40_000)
    engine.pause()
    rerender({ item: REC, origin: TUNE_ROW, overlayId: null })

    await expect
      .poll(() => analytics.sends())
      .toEqual([
        {
          name: 'playback_ended',
          props: expect.objectContaining({
            source: 'recording_screen',
            ended_by: 'closed',
            recording_id: 'rec-1',
          }),
        },
      ])
    // The visit's outcome is settled before its play is reported, so a practice report would
    // already be here.
    expect(analytics.sends().map((send) => send.name)).toEqual(['playback_ended'])
  })

  it('practice_ended reports a visit that played a loop, and no play', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1', { tune_id: 'tune-1' }))
    const analytics = recordingAnalytics()
    const { rerender } = harness(
      db,
      engine,
      now,
      { item: REC, origin: TUNE_ROW, overlayId: 'rec-1' },
      analytics,
    )
    loadAndPlay(engine)
    engine.setLoop({ id: 'loop-1', label: 'B part', fromS: 10, toS: 20 })
    engine.setRepeat(true)
    advance(40_000)
    engine.pause()
    rerender({ item: REC, origin: TUNE_ROW, overlayId: null })

    await expect
      .poll(() => analytics.sends())
      .toEqual([
        {
          name: 'practice_ended',
          props: {
            source: 'dock',
            duration_bucket: '30s-2m',
            used_loops: true,
            used_speed: false,
            used_pitch: false,
            kind: 'recorded',
            recording_id: 'rec-1',
            tune_id: 'tune-1',
          },
        },
      ])
  })

  it('a tab hidden while paused ends the play as paused, and a closed page as closed', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const analytics = recordingAnalytics()
    harness(db, engine, now, { item: REC, origin: TUNE_ROW }, analytics)
    loadAndPlay(engine)
    advance(5_000)
    engine.pause()
    hidePage()
    await expect.poll(() => ends(analytics)).toEqual([['rec-1', 'paused', false]])
    showPage()
    engine.play()
    advance(5_000)
    window.dispatchEvent(new PageTransitionEvent('pagehide'))

    await expect
      .poll(() => ends(analytics))
      .toEqual([
        ['rec-1', 'paused', false],
        ['rec-1', 'closed', false],
      ])
  })

  it('practice hidden while paused ends its play as paused', async () => {
    const { db, engine, now, advance } = setup()
    await db.recordings.put(recordingRow('rec-1'))
    const analytics = recordingAnalytics()
    harness(db, engine, now, { item: REC, origin: TUNE_ROW, overlayId: 'rec-1' }, analytics)
    loadAndPlay(engine)
    advance(5_000)
    engine.pause()
    hidePage()

    await expect.poll(() => ends(analytics)).toEqual([['rec-1', 'paused', false]])
  })

  it('practice closing with the page reports no play for the hand-off back to itself', async () => {
    const { db, engine } = setup()
    // A clock that moves on with every read, so any hand-off play would have length.
    let t = Date.parse('2026-03-01T12:00:00.000Z')
    const now = () => (t += 1)
    await db.recordings.put(recordingRow('rec-1'))
    const analytics = recordingAnalytics()
    const { rerender } = harness(
      db,
      engine,
      now,
      { item: REC, origin: TUNE_ROW, overlayId: 'rec-1' },
      analytics,
    )
    loadAndPlay(engine)
    t += 20_000
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    t += 20_000
    engine.pause()
    rerender({ item: REC, origin: TUNE_ROW, overlayId: null })

    const visits = () =>
      analytics
        .sends()
        .map((send) => send.props as { source?: string; listened_bucket?: string })
        .map((props) => [props.source, props.listened_bucket])
    await expect.poll(visits).toEqual([
      ['recording_screen', '10-30s'],
      ['recording_screen', '10-30s'],
    ])
  })
})
