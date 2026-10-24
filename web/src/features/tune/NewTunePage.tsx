import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { TUNE_LIMITS } from '../../api/vocabulary'
import { destination } from '../../layout/destinations'
import { BackLink, PaneBar } from '../../layout/PaneBar'
import { tuneHomePath } from '../../layout/tuneHome'
import { ErrorLine } from '../../ui/ErrorLine'
import { TextField } from '../../ui/form/TextField'
import { useToast } from '../../ui/Toast'
import { messageFor, useAction } from '../../ui/useAction'
import { useElementSize } from '../../ui/useElementSize'
import { useLatest } from '../../ui/useLatest'
import { onPageLeave } from '../player/activity'
import { markKeyFocus } from './freshTune'
import { newTuneSource } from './newTuneState'
import { bandGutter, factsLayout } from './factsLayout'
import { TUNE_TITLE_LABEL } from './tuneFormCopy'
import { useAddTune } from './useAddTune'

const CATALOG = destination('catalog')

/**
 * The page a new tune starts on: the band with a focused title field and nothing else. Enter
 * creates the tune and the address becomes its page. Leaving the page with text typed creates
 * the tune too and leaves the navigation alone, and closing or hiding its tab creates it as
 * well. An empty or blank title writes nothing.
 */
export function NewTunePage() {
  const navigate = useNavigate()
  const source = newTuneSource(useLocation().state)
  const { error, run } = useAction()
  const addTune = useAddTune()
  const toast = useToast()
  const [title, setTitle] = useState('')
  // Measured as the tune page measures, so the band keeps its gutter as the tune is created.
  const root = useRef<HTMLDivElement>(null)
  const gutter = bandGutter(factsLayout(useElementSize(root).width))
  // Settled once a create starts, by Enter or by leaving, so nothing creates the tune twice.
  const submitted = useRef(false)
  const mounted = useRef(true)

  // Closing or hiding the tab leaves the page too. The tune is made as the tab goes, best effort
  // since the browser may stop the write, and takes the page's place if the tab comes back.
  const hide = () => {
    const next = title.trim()
    if (!next || submitted.current) return
    submitted.current = true
    addTune({ title: next, source }).then(
      (tuneId) => {
        if (mounted.current) void navigate(tuneHomePath(tuneId), { replace: true })
      },
      (caught: unknown) => {
        submitted.current = false
        toast.show(messageFor(caught))
      },
    )
  }
  const hideRef = useLatest(hide)
  useEffect(() => onPageLeave(() => hideRef.current()), [hideRef])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const latest = useLatest({ title, source, addTune })
  useEffect(
    () => () => {
      const { title: typed, source: from, addTune: add } = latest.current
      const next = typed.trim()
      if (!next || submitted.current) return
      // Leaving the page creates what was typed, and the navigation that left it stays.
      add({ title: next, source: from }).catch((caught: unknown) => toast.show(messageFor(caught)))
    },
    [latest, toast],
  )

  const create = () => {
    const next = title.trim()
    if (!next || submitted.current) return
    submitted.current = true
    run(async () => {
      try {
        const tuneId = await addTune({ title: next, source })
        // Left while the tune was made: wherever the musician went stands.
        if (!mounted.current) return
        markKeyFocus(tuneId)
        void navigate(tuneHomePath(tuneId), { replace: true })
      } catch (caught) {
        submitted.current = false
        throw caught
      }
    })
  }

  return (
    <div ref={root}>
      <PaneBar leading={<BackLink to={CATALOG.root} label={CATALOG.label} />} />
      <article>
        <header className="pt-2 pb-5">
          <form
            className={`flex flex-col gap-2 ${gutter}`}
            onSubmit={(event) => {
              event.preventDefault()
              create()
            }}
          >
            <TextField
              label={TUNE_TITLE_LABEL}
              standalone
              autoFocus
              value={title}
              onChange={setTitle}
              maxLength={TUNE_LIMITS.title}
              enterKeyHint="done"
            />
            <ErrorLine error={error} place="inline" />
          </form>
        </header>
      </article>
    </div>
  )
}
