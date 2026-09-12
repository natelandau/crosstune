import {
  useCanGoBack,
  useLocation,
  useNavigate,
  useParams,
  useRouter,
  useSearch,
} from '@tanstack/react-router'
import { SongDetail } from './SongDetail'

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** Set on the entry this page pushes for edit mode, so Cancel knows Back lands on the song. */
    editPushed?: boolean
  }
}

export function SongPage() {
  const { id } = useParams({ from: '/songs/$id' })
  const { edit } = useSearch({ from: '/songs/$id' })
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  // Carried on the history entry itself so it survives a reload, unlike component state.
  const editPushed = useLocation({ select: (location) => location.state.editPushed === true })
  return (
    <SongDetail
      songId={id}
      edit={edit ?? false}
      onEditChange={(next) => {
        if (next) {
          void navigate({
            to: '/songs/$id',
            params: { id },
            search: { edit: true },
            state: { editPushed: true },
          })
        } else if (editPushed && canGoBack) {
          // Pop the entry edit mode pushed, so Back does not land on the form again.
          router.history.back()
        } else {
          void navigate({ to: '/songs/$id', params: { id }, search: {}, replace: true })
        }
      }}
      onDeleted={() => void navigate({ to: '/', replace: true })}
    />
  )
}
