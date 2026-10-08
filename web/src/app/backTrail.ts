import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType, type Location } from 'react-router'
import { useLatest } from '../ui/useLatest'

const STORAGE_KEY = 'crosstune.backTrail'
// Enough entries for any Back a person walks; the oldest go first so storage stays small.
const LIMIT = 200

/** Reads the session's mirror of the trail, dropping anything malformed. */
export function readStoredTrail(): Map<string, string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return new Map()
    return new Map(
      parsed.filter(
        (pair): pair is [string, string] =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          typeof pair[0] === 'string' &&
          typeof pair[1] === 'string',
      ),
    )
  } catch {
    return new Map()
  }
}

// History hides the entry behind the current one, so each pushed entry records where it came
// from. A replace keeps the entry behind, so it carries the record over. An entry's key lives
// in history state and survives a reload, so the record is mirrored to the session to match.
let entered = readStoredTrail()

function record(key: string, from: string) {
  entered.delete(key)
  entered.set(key, from)
  for (const oldest of entered.keys()) {
    if (entered.size <= LIMIT) break
    entered.delete(oldest)
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...entered]))
  } catch {
    // Storage can be blocked; the in-memory map still serves this page load.
  }
}

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

/** The pathname of the entry behind the one with `key`, when this session saw it pushed. */
export function enteredFrom(key: string): string | undefined {
  return entered.get(key)
}

export function useBackTrail() {
  const location = useLocation()
  const type = useNavigationType()
  const previous = useRef<Location | null>(null)
  useEffect(() => {
    const prev = previous.current
    previous.current = location
    if (!prev || prev.key === location.key) return
    if (type === 'PUSH') record(location.key, trimSlash(prev.pathname))
    else if (type === 'REPLACE') {
      const behind = entered.get(prev.key)
      if (behind !== undefined) record(location.key, behind)
    }
  }, [location, type])
}

/**
 * Returns a function that leaves the current page for `to`, its parent. It walks history when
 * the entry behind is the parent, so Back stays Back and the page is not left behind as a
 * forward entry; after a deep link nothing is behind, and it replaces the page.
 */
export function useLeaveTo(): (to: string) => void {
  const navigate = useNavigate()
  const keyRef = useLatest(useLocation().key)
  return useCallback(
    (to: string) =>
      void (enteredFrom(keyRef.current) === to ? navigate(-1) : navigate(to, { replace: true })),
    [navigate, keyRef],
  )
}

export function resetBackTrailForTest() {
  entered.clear()
}

/** Reads the trail back from the session, as a reload does. */
export function reloadBackTrailForTest() {
  entered = readStoredTrail()
}
