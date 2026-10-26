import { Pencil, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { TUNE_LIMITS } from '../../api/vocabulary'
import { usePaneTitleLine } from '../../layout/ColumnTitle'
import { useFrame } from '../../platform/frame'
import { ErrorLine } from '../../ui/ErrorLine'
import { pitchClass } from '../../ui/keyColor'
import { KEY, spokenKey } from '../../ui/keyName'
import { PRESS, WASH_HOVER } from '../../ui/press'
import { useLatest } from '../../ui/useLatest'
import { ARCHIVED } from './archiveLabels'
import { takeKeyFocus } from './freshTune'
import { FactEditor } from './FactEditor'
import { FactEditorBody } from './factEditors'
import { namedMode } from './factRows'
import { TUNE_TITLE_LABEL } from './tuneFormCopy'
import { TUNE } from './tunePageCopy'
import { EDIT_TITLE, KEY_TILE_EMPTY } from './tuneScreenCopy'
import { useFactWrite, type FactWrite } from './useFactWrite'
import type { TuneView } from './useTune'
import type { TuneFacts } from './useTuneScreen'

/** The view-transition name a tune's title carries in its row and on its page. */
// eslint-disable-next-line react-refresh/only-export-components
export const tuneTitleTransition = (tuneId: string) => `tune-title-${tuneId}`

/**
 * The top of a tune's page, on the page ground: the key tile in the key's color, the title in
 * the page title role, other names, and the action button row. The title renames in place, and the tile
 * opens the key editor. Off the phone More ends the title's row. Until the facts have read it
 * is the title alone, or a hidden "Tune" while even that is unknown, so focus and the morph have
 * one heading to land on throughout.
 * `active` is false for a page held off screen, which leaves the pane bar's title to the page
 * on screen.
 */
export function TuneBand({
  tuneId,
  view,
  facts,
  title,
  active,
  actions,
  more,
  gutter,
}: {
  tuneId: string
  /** The live tune, for the key editor; undefined while it reads and once it is gone. */
  view: TuneView | undefined
  facts: TuneFacts | null
  /** The title to show before the facts have read; the facts' own title wins. */
  title: string | undefined
  active: boolean
  actions: ReactNode
  /** The page's More, where it sits on the title's row rather than in the pane bar. */
  more?: ReactNode
  /** Classes that set the band's content in line with the page's column below it. */
  gutter: string
}) {
  const write = useFactWrite(tuneId)
  const mode = facts?.modes[0]
  return (
    <header className="pt-2 pb-5">
      <div className={`flex flex-col gap-4 ${gutter}`}>
        <div className="flex items-center gap-4">
          {facts && (
            <KeyTile
              tuneId={tuneId}
              write={write}
              view={view}
              keyName={facts.key}
              mode={namedMode(mode) ? mode : undefined}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Title
              tuneId={tuneId}
              title={facts?.title ?? title}
              editable={facts !== null}
              active={active}
              onRename={(next) => write.write({ title: next })}
              trailing={more}
            />
            {facts && facts.alternateTitles.length > 0 && (
              <p className="t-secondary text-ink-2">{facts.alternateTitles.join(', ')}</p>
            )}
            {facts?.archived && (
              <p className="t-caption bg-field self-start rounded-(--radius-capsule) px-2 py-0.5">
                {ARCHIVED}
              </p>
            )}
          </div>
        </div>
        <ErrorLine error={write.error} place="inline" />
        {facts && actions}
      </div>
    </header>
  )
}

function KeyTile({
  tuneId,
  write,
  view,
  keyName,
  mode,
}: {
  tuneId: string
  /** The band's writer, so a refused key shows under the title with any other refusal. */
  write: FactWrite
  view: TuneView | undefined
  keyName: string | null
  mode: string | undefined
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (takeKeyFocus(tuneId)) trigger.current?.focus()
  }, [tuneId])
  const pitch = keyName ? pitchClass(keyName) : null
  const colors: CSSProperties | undefined = keyName
    ? pitch === null
      ? { background: 'var(--color-field)', color: 'var(--color-ink)' }
      : { background: `var(--key-${pitch}-bg)`, color: `var(--key-${pitch}-ink)` }
    : undefined
  const name = keyName ? `${KEY}, ${spokenKey(keyName)}${mode ? ` ${mode}` : ''}` : KEY_TILE_EMPTY
  return (
    <>
      <AriaButton
        ref={trigger}
        aria-label={name}
        aria-haspopup="dialog"
        onPress={() => setOpen(true)}
        style={colors}
        data-key-tile
        className={`flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl ${PRESS} ${
          keyName
            ? ''
            : 'text-ink-2 border-[1.5px] border-dashed border-[color-mix(in_srgb,var(--color-ink)_25%,transparent)]'
        }`}
      >
        {keyName ? (
          <>
            <span className="text-[1.625rem] leading-none font-bold tracking-tight">{keyName}</span>
            {mode && <span className="t-caption font-medium">{mode}</span>}
          </>
        ) : (
          <span className="t-secondary flex items-center gap-0.5 font-medium">
            <Plus className="size-3.5 shrink-0" aria-hidden />
            {KEY}
          </span>
        )}
      </AriaButton>
      {open && (
        <FactEditor
          label={KEY}
          triggerRef={trigger}
          isOpen
          onOpenChange={setOpen}
          stored={{}}
          gone={!view}
          onCommit={write.write}
        >
          {view && <FactEditorBody id="key" view={view} write={write} />}
        </FactEditor>
      )}
    </>
  )
}

/**
 * The page title, selectable. A click that selects nothing turns it into a field, as does the
 * Rename button beside it, which shows on hover and focus, and always on touch, which has no
 * hover. Enter or leaving saves, Escape restores, and an emptied title restores the stored one
 * rather than saving.
 */
function Title({
  tuneId,
  title,
  editable,
  active,
  onRename,
  trailing,
}: {
  tuneId: string
  title: string | undefined
  editable: boolean
  active: boolean
  onRename: (title: string) => void
  /** Set at the row's end, centered on the title's first line. */
  trailing?: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  usePaneTitleLine(heading, active)
  // Only off wide does a row title morph into this one; on wide the title lifts with the page.
  const morphs = useFrame() !== 'wide'
  const [draft, setDraft] = useState<string | null>(null)
  const rename = useRef<HTMLButtonElement>(null)
  // Set as Enter or Escape ends the edit, so focus returns to the title it renamed.
  const refocus = useRef(false)
  // Enter ends the edit and unmounts the field, which can also fire its blur.
  const settled = useRef(false)

  const editing = draft !== null
  useEffect(() => {
    if (editing || !refocus.current) return
    refocus.current = false
    rename.current?.focus()
  }, [editing])

  const finish = (save: boolean, returnFocus: boolean) => {
    if (settled.current || draft === null) return
    settled.current = true
    const next = draft.trim()
    if (save && next && next !== title) onRename(next)
    setDraft(null)
    refocus.current = returnFocus
  }

  // A page that goes with the field still open, as Back by keyboard does with no blur, saves
  // the typed title as a blur would.
  const unsaved = useLatest({ draft, title, onRename })
  useEffect(
    () => () => {
      const { draft: typed, title: stored, onRename: save } = unsaved.current
      if (settled.current || typed === null) return
      const next = typed.trim()
      if (next && next !== stored) save(next)
    },
    [unsaved],
  )

  const start = () => {
    if (!title) return
    settled.current = false
    setDraft(title)
  }

  return (
    <div className="group flex items-start gap-1">
      {/* The heading keeps its place under the field, so the pane bar's watch on it holds. */}
      <div className="t-page-title grid min-w-0 flex-1">
        <h1
          ref={heading}
          onClick={
            editable
              ? // A drag that selects the title's text is reading it, not renaming it.
                () => {
                  if (window.getSelection()?.isCollapsed ?? true) start()
                }
              : undefined
          }
          className={`[grid-area:1/1] ${title ? 't-page-title select-text' : 'sr-only'} ${editing ? 'invisible' : ''}`}
          style={morphs ? { viewTransitionName: tuneTitleTransition(tuneId) } : undefined}
        >
          {title ?? TUNE}
        </h1>
        {editing && (
          <input
            aria-label={TUNE_TITLE_LABEL}
            value={draft}
            maxLength={TUNE_LIMITS.title}
            enterKeyHint="done"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                finish(true, true)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                finish(false, true)
              }
            }}
            onBlur={() => finish(true, false)}
            className="t-page-title bg-ground/60 -mx-1.5 min-w-0 rounded-(--radius-row) px-1.5 [grid-area:1/1]"
            // Over the field size the touch layout sets, so the field matches the title it covers.
            style={{ fontSize: 'inherit' }}
          />
        )}
      </div>
      {editable && title && !editing && (
        <AriaButton
          ref={rename}
          aria-label={`${EDIT_TITLE} ${title}`}
          onPress={start}
          className={`text-ink-2 grid size-(--target) shrink-0 place-items-center rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 in-[html[data-density=touch]]:opacity-100 ${WASH_HOVER} ${PRESS}`}
        >
          <Pencil className="size-4" aria-hidden />
        </AriaButton>
      )}
      {trailing && (
        <div className="t-page-title ms-auto flex h-[1lh] shrink-0 items-center">{trailing}</div>
      )}
    </div>
  )
}
