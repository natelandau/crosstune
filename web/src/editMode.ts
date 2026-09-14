import {
  useCanGoBack,
  useLocation,
  useNavigate,
  useParams,
  useRouter,
  useSearch,
} from '@tanstack/react-router'

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
  }
}

/** The page's id and edit flag from the URL, and a setter that enters or leaves edit mode through history. */
export function useEditMode(from: '/songs/$id' | '/lists/$id') {
  const { id } = useParams({ from })
  const { edit } = useSearch({ from })
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  // Carried on the history entry itself so it survives a reload, unlike component state.
  const editPushed = useLocation({ select: (location) => location.state.editPushed === true })

  const setEdit = (next: boolean) => {
    if (next) {
      void navigate({
        to: from,
        params: { id },
        search: { edit: true },
        state: { editPushed: true },
      })
    } else if (editPushed && canGoBack) {
      // Pop the entry edit mode pushed, so Back does not land on the form again.
      router.history.back()
    } else {
      void navigate({ to: from, params: { id }, search: {}, replace: true })
    }
  }

  return { id, edit: edit ?? false, setEdit }
}
