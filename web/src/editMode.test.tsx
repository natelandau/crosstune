import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from './db/schema'
import { useSelectMode, validateSelectSearch } from './editMode'
import { openTestDb } from './test/db'
import { renderWithProviders } from './test/render'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

function Probe() {
  const { select, setSelect } = useSelectMode()
  return (
    <>
      <p>{select ? 'selecting' : 'browsing'}</p>
      <button type="button" onClick={() => setSelect(!select)}>
        Toggle
      </button>
      <button
        type="button"
        onClick={() => {
          setSelect(false)
          setSelect(false)
        }}
      >
        Leave twice
      </button>
    </>
  )
}

describe('validateSelectSearch', () => {
  it('keeps only a true select flag', () => {
    expect(validateSelectSearch({ select: true })).toEqual({ select: true })
    expect(validateSelectSearch({ select: 'true' })).toEqual({ select: true })
    expect(validateSelectSearch({ select: 'yes' })).toEqual({})
    expect(validateSelectSearch({})).toEqual({})
  })
})

describe('useSelectMode', () => {
  it('pushes a history entry on entry and pops it, not a new one, on exit', async () => {
    const { router } = renderWithProviders(<Probe />, { db })
    expect(await screen.findByText('browsing')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ select: true }))
    expect(router.state.location.state.selectPushed).toBe(true)
    expect(await screen.findByText('selecting')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    // Leaving pops the entry entering pushed, rather than pushing a new one.
    expect(router.history.canGoBack()).toBe(false)
    expect(await screen.findByText('browsing')).toBeInTheDocument()
  })

  it('reads the flag from a deep link and leaves it by replacing', async () => {
    const { router } = renderWithProviders(<Probe />, { db, path: '/?select=true' })
    expect(await screen.findByText('selecting')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    // Nothing was pushed on entry here, so leaving must replace, not pop, to avoid a stray Back target.
    expect(router.history.canGoBack()).toBe(false)
    expect(await screen.findByText('browsing')).toBeInTheDocument()
  })

  it('pops only one entry when asked to leave twice before a re-render', async () => {
    const { router } = renderWithProviders(<Probe />, { db })
    expect(await screen.findByText('browsing')).toBeInTheDocument()
    await router.navigate({ to: '/', search: { q: 'waltz' } as never })
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'waltz' }))

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'waltz', select: true }))

    // A browser goes back on a later popstate; memory history would go back at once and hide a double pop.
    const back = router.history.back.bind(router.history)
    vi.spyOn(router.history, 'back').mockImplementation(() => void setTimeout(back, 0))
    await userEvent.click(screen.getByRole('button', { name: 'Leave twice' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'waltz' }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(router.state.location.search).toEqual({ q: 'waltz' })
    expect(router.history.canGoBack()).toBe(true)
  })

  it('leaves other search params in place when leaving selection mode', async () => {
    const { router } = renderWithProviders(<Probe />, { db, path: '/?select=true&q=waltz' })
    expect(await screen.findByText('selecting')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'waltz' }))
    expect(await screen.findByText('browsing')).toBeInTheDocument()
  })
})
