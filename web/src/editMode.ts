import { useLocation, useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, type RefObject } from 'react'

type Flag = 'edit' | 'select'
const PUSHED = { edit: 'editPushed', select: 'selectPushed' } as const

/** The entry being left, forgotten once the location changes so Forward back onto it can leave again. */
function useLeavingEntry(): RefObject<string | null> {
  const leaving = useRef<string | null>(null)
  const locationKey = useLocation({
    select: (location) => location.state.__TSR_key ?? location.state.key ?? location.href,
  })
  useEffect(() => {
    leaving.current = null
  }, [locationKey])
  return leaving
}

/**
 * Leave a URL flag at most once per history entry. A second tap can land before React re-renders,
 * so this reads the live history entry rather than values captured at render. Returns how to leave,
 * or null when the entry has already been left or is being left.
 */
function leaveOnce(
  router: ReturnType<typeof useRouter>,
  flag: Flag,
  leaving: RefObject<string | null>,
): 'back' | 'replace' | null {
  const live = router.history.location
  const key = live.state.__TSR_key ?? live.state.key ?? live.href
  if (new URLSearchParams(live.search).get(flag) !== 'true' || leaving.current === key) return null
  leaving.current = key
  return live.state[PUSHED[flag]] === true && router.history.canGoBack() ? 'back' : 'replace'
}

/** Search params for a page whose edit mode is addressable by URL. */
export interface EditSearch {
  edit?: boolean
}

export function validateEditSearch(search: Record<string, unknown>): EditSearch {
  return search.edit === true || search.edit === 'true' ? { edit: true } : {}
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** Set on the entry a page pushes for edit mode, so leaving edit knows Back lands on the view. */
    editPushed?: boolean
    /** Set on the entry a screen pushes for selection mode, for the same reason. */
    selectPushed?: boolean
  }
}

/** The page's id and edit flag from the URL, and a setter that enters or leaves edit mode through history. */
export function useEditMode(from: '/songs/$id' | '/lists/$id') {
  const { id } = useParams({ from })
  const { edit } = useSearch({ from })
  const navigate = useNavigate()
  const router = useRouter()
  const leaving = useLeavingEntry()

  const setEdit = (next: boolean) => {
    if (next) {
      void navigate({
        to: from,
        params: { id },
        search: { edit: true },
        // Carried on the history entry itself so it survives a reload, unlike component state.
        state: { editPushed: true },
      })
      return
    }
    const how = leaveOnce(router, 'edit', leaving)
    if (how === 'back') {
      // Pop the entry edit mode pushed, so Back does not land on the form again.
      router.history.back()
    } else if (how === 'replace') {
      void navigate({ to: from, params: { id }, search: {}, replace: true })
    }
  }

  return { id, edit: edit ?? false, setEdit }
}

/** Search params for a screen whose selection mode is addressable by URL. */
export interface SelectSearch {
  select?: boolean
}

export function validateSelectSearch(search: Record<string, unknown>): SelectSearch {
  return search.select === true || search.select === 'true' ? { select: true } : {}
}

/** Selection mode on the current screen, entered and left through history like edit mode. */
export function useSelectMode(): { select: boolean; setSelect: (next: boolean) => void } {
  const select = useSearch({
    strict: false,
    select: (search: Record<string, unknown>) => search.select === true,
  })
  const navigate = useNavigate()
  const router = useRouter()
  const leaving = useLeavingEntry()

  const setSelect = (next: boolean) => {
    if (next) {
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, select: true }),
        state: { selectPushed: true },
      })
      return
    }
    const how = leaveOnce(router, 'select', leaving)
    if (how === 'back') {
      // Pop the entry selection pushed, so Back does not return to selecting.
      router.history.back()
    } else if (how === 'replace') {
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => {
          const rest = { ...prev }
          delete rest.select
          return rest
        },
        replace: true,
      })
    }
  }

  return { select, setSelect }
}
