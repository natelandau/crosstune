import 'posthog-js/dist/posthog-recorder'
import { afterEach, describe, expect, it } from 'vitest'
import { WEB_POSTHOG_CONFIG } from './config'

const TITLE = 'The Silver Spear'
const LEAKS = [/Silver.Spear/i, /search_query/, /youtube/]

type RrwebRecord = (options: Record<string, unknown>) => (() => void) | undefined

interface MutationEvent {
  type: number
  data: { source?: number; adds?: { node: { attributes?: Record<string, unknown> } }[] }
}

// The recorder registers the same rrweb build the SDK records with.
function rrwebRecord(): RrwebRecord {
  const extensions = (
    window as unknown as { __PosthogExtensions__?: { rrweb?: { record: RrwebRecord } } }
  ).__PosthogExtensions__
  const record = extensions?.rrweb?.record
  if (!record) throw new Error('the PostHog recorder did not register rrweb')
  return record
}

// The rows and bars that carry a tune's title or a saved link in their attributes.
function mountContent(): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = `
    <div role="row" class="pane-row" aria-label="Open ${TITLE}">
      <a href="https://www.youtube.com/watch?v=abc&amp;t=${encodeURIComponent(TITLE)}"
         aria-label="Open ${TITLE} on YouTube" title="${TITLE}">link</a>
      <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(TITLE)}">find</a>
      <a href="/lists/${encodeURIComponent(TITLE)}?q=${encodeURIComponent(TITLE)}">list</a>
      <span aria-hidden="true" data-title="${TITLE}"></span>
      <button data-set="${TITLE}" aria-description="${TITLE}">filter</button>
      <iframe src="https://www.youtube-nocookie.com/embed/abc" title="${TITLE}"></iframe>
      <input value="${TITLE}" placeholder="${TITLE}" />
    </div>`
  document.body.append(root)
  return root
}

describe('session replay', () => {
  const cleanups: (() => void)[] = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  function record(options: Record<string, unknown>): unknown[] {
    const events: unknown[] = []
    const stop = rrwebRecord()({ emit: (event: unknown) => events.push(event), ...options })
    if (stop) cleanups.push(stop)
    return events
  }

  function contentAttributes(events: unknown[]): string {
    return JSON.stringify(events)
  }

  it('records the attributes the app sets without words or outside URLs', async () => {
    const root = mountContent()
    cleanups.push(() => root.remove())
    const { session_recording: options } = WEB_POSTHOG_CONFIG
    const events = record({
      maskAllInputs: options.maskAllInputs,
      maskTextSelector: options.maskTextSelector,
      maskAttributeFn: options.maskAttributeFn,
    })
    await expect.poll(() => events.length).toBeGreaterThan(0)

    const row = root.querySelector('[role="row"]')!
    row.setAttribute('aria-label', `Play ${TITLE}`)
    const added = document.createElement('a')
    added.href = `https://example.com/${encodeURIComponent(TITLE)}`
    added.dataset.title = TITLE
    row.append(added)
    // An incremental snapshot (3) from the mutation observer (source 0) that adds the link.
    await expect
      .poll(() =>
        (events as MutationEvent[]).some(
          (e) =>
            e.type === 3 &&
            e.data.source === 0 &&
            e.data.adds?.some((add) => add.node.attributes?.['data-title'] !== undefined),
        ),
      )
      .toBe(true)

    const recorded = contentAttributes(events)
    for (const leak of LEAKS) expect(recorded).not.toMatch(leak)
    expect(recorded).toContain('"class":"pane-row"')
  })

  it('would record them without the attribute mask', async () => {
    const root = mountContent()
    cleanups.push(() => root.remove())
    const { session_recording: options } = WEB_POSTHOG_CONFIG
    const events = record({
      maskAllInputs: options.maskAllInputs,
      maskTextSelector: options.maskTextSelector,
    })
    await expect.poll(() => contentAttributes(events)).toMatch(LEAKS[0]!)
  })
})
