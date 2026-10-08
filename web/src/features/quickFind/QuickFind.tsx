import { Search } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Autocomplete,
  Collection,
  Dialog,
  Header,
  Input,
  ListBox,
  ListBoxSection,
  TextField,
} from 'react-aria-components'
import { NEW_LIST_TITLE } from '../lists/listsCopy'
import {
  goToLabel,
  NO_MATCHES,
  QUICK_FIND_PLACEHOLDER,
  QUICK_FIND_SECTIONS,
  type QuickFindCommand,
  type QuickFindItem,
} from './quickFindResults'
import { useQuickFind, type QuickFind as Finder } from './useQuickFind'
import { QUICK_FIND, shortcutById, type ShortcutId } from '../keyboard/keymap'
import { useLatest } from '../../ui/useLatest'
import { destination, type Destination } from '../../app/destinations'
import { useScreenCommands } from '../../app/screenCommands'
import { useShortcutSheet } from '../keyboard/shortcutSheetLauncher'
import { useListNameLauncher } from '../lists/listNameLauncher'
import { useStampedDensity } from '../../platform/density'
import { useRecordLauncher } from '../../app/recordLauncher'
import { useTuneFormLauncher } from '../tune/formLauncher'
import type { TunePick } from '../tune/tunePick'
import { useOverlayClaim } from '../../ui/overlayClaim'
import { PointerOverlay } from '../../ui/PointerOverlay'
import { Sheet } from '../../ui/Sheet'
import { SHEET } from '../../ui/sheetGeometry'
import { QuickFindContext, useQuickFindLauncher, type QuickFindState } from './quickFindLauncher'
import { ResultRow } from './ResultRow'

export type QuickFindNavigate = (to: string, state?: unknown) => void

/** Whether Quick Find shows, Cmd-K's way to show it, and its field for a second Cmd-K. */
export function QuickFindProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)
  const state = useMemo<QuickFindState>(
    () => ({
      shown,
      fieldRef,
      open: () => {
        if (shown) fieldRef.current?.focus()
        else setShown(true)
      },
      close: () => setShown(false),
    }),
    [shown],
  )
  return <QuickFindContext.Provider value={state}>{children}</QuickFindContext.Provider>
}

const shortcutLabel = (id: ShortcutId) => shortcutById(id).label

const GO_TO: { id: ShortcutId; to: Destination }[] = [
  { id: 'goCatalog', to: 'catalog' },
  { id: 'goLists', to: 'lists' },
  { id: 'goRecordings', to: 'recordings' },
  { id: 'goSettings', to: 'settings' },
]

/** The showing screen's commands, then every command the app offers from anywhere. */
function useCommands(navigate: QuickFindNavigate): QuickFindCommand[] {
  const form = useTuneFormLauncher()
  const record = useRecordLauncher()
  const listName = useListNameLauncher()
  const sheet = useShortcutSheet()
  const screen = useScreenCommands()
  return [
    ...screen,
    {
      id: 'newTune',
      label: shortcutLabel('newTune'),
      shortcut: 'newTune',
      run: () => form.open({}),
    },
    ...(record.available
      ? [
          {
            id: 'record',
            label: shortcutLabel('record'),
            shortcut: 'record' as const,
            run: () => record.start(),
          },
        ]
      : []),
    { id: 'newList', label: NEW_LIST_TITLE, run: listName.open },
    ...GO_TO.map(({ id, to }) => ({
      id,
      label: goToLabel(destination(to).label),
      shortcut: id,
      run: () => navigate(destination(to).root),
    })),
    {
      id: 'shortcuts',
      label: shortcutLabel('shortcuts'),
      shortcut: 'shortcuts',
      run: sheet.open,
    },
  ]
}

/**
 * Finds tunes, lists, and recordings, and runs the app's commands: a field in the window's
 * upper third on pointer, a full-height sheet on touch. A choice runs once Quick Find has
 * closed, so focus is back where it was before a sheet it opens takes it.
 */
export function QuickFind({ navigate }: { navigate: QuickFindNavigate }) {
  const { shown, close, fieldRef } = useQuickFindLauncher()
  const touch = useStampedDensity() === 'touch'
  const commands = useCommands(navigate)
  const chosen = useRef<(() => void) | null>(null)
  // The field keeps focus through a click on a result, so focus cannot tell a click from a key.
  const pointerPick = useRef(false)
  const navigateRef = useLatest(navigate)

  const finder = useQuickFind(shown, {
    commands,
    onChoose: (item) => {
      chosen.current = choiceFor(item, (to, state) => navigateRef.current(to, state), {
        quiet: !pointerPick.current,
      })
      pointerPick.current = false
      close()
    },
  })

  // Showing again before the exit finishes cancels it, and with it the run on close.
  useEffect(() => {
    if (shown) chosen.current = null
  }, [shown])

  const settle = () => {
    const run = chosen.current
    chosen.current = null
    run?.()
  }

  const body = (
    <FinderBody
      finder={finder}
      fieldRef={fieldRef}
      markPick={(pointer) => {
        pointerPick.current = pointer
      }}
    />
  )

  if (touch) {
    return (
      <Sheet
        isOpen={shown}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={QUICK_FIND}
        height="full"
        onClosed={settle}
      >
        {body}
      </Sheet>
    )
  }
  return (
    <AnimatePresence onExitComplete={settle}>
      {shown && (
        <PointerOverlay
          key="quick-find"
          placement="upper"
          onOpenChange={(open) => {
            if (!open) close()
          }}
          className="bg-ground flex max-h-[70vh] max-w-full flex-col overflow-hidden rounded-(--radius-surface) shadow-(--shadow-float)"
          style={{ width: SHEET.width }}
        >
          <Dialog aria-label={QUICK_FIND} className="flex min-h-0 flex-col p-2 outline-none">
            {body}
          </Dialog>
        </PointerOverlay>
      )}
    </AnimatePresence>
  )
}

/** What choosing an item does once Quick Find has closed. */
function choiceFor(item: QuickFindItem, navigate: QuickFindNavigate, pick: TunePick): () => void {
  switch (item.kind) {
    case 'command':
      return () => item.command.run?.()
    case 'tune':
      return () => navigate(`${destination('catalog').root}/${item.tuneId}`, pick)
    case 'list':
      return () => navigate(`${destination('lists').root}/${item.listId}`)
    case 'recording': {
      const recordings = destination('recordings').root
      return () => navigate(item.tuneId ? `${recordings}/${item.tuneId}` : recordings)
    }
  }
}

function FinderBody({
  finder,
  fieldRef,
  markPick,
}: {
  finder: Finder
  fieldRef: RefObject<HTMLInputElement | null>
  /** Hears a press on a result or a key, so a choice knows which picked it. */
  markPick: (pointer: boolean) => void
}) {
  const { query, setQuery, sections, ready, step, run, leaveStep } = finder
  // A second step sits over the first, so Escape and back step out of it before closing.
  const stepOnTop = useOverlayClaim({ close: leaveStep, active: step !== null })
  const leaveStepRef = useLatest(leaveStep)
  // Heard at window capture, ahead of the field, which hands Escape on to the dialog, and of
  // the dialog itself, which closes on it and takes focus from a click on its padding.
  useEffect(() => {
    if (step === null) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !stepOnTop()) return
      event.preventDefault()
      event.stopPropagation()
      leaveStepRef.current()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [step, stepOnTop, leaveStepRef])
  const byKey = new Map(
    sections.flatMap((section) => section.items).map((item) => [item.key, item]),
  )
  const searched = query.trim() !== '' && (ready || step !== null)
  return (
    <Autocomplete inputValue={query} onInputChange={setQuery}>
      <TextField
        data-search-field
        aria-label={QUICK_FIND}
        autoFocus
        className="bg-fill flex min-h-(--target-control) shrink-0 items-center rounded-(--radius-capsule) ps-3 pe-1"
      >
        <Search className="text-ink-2 size-4 shrink-0" aria-hidden />
        <Input
          ref={fieldRef}
          onKeyDownCapture={() => markPick(false)}
          placeholder={QUICK_FIND_PLACEHOLDER}
          className="t-body placeholder:text-ink-2 min-w-0 flex-1 bg-transparent px-2 in-[html[data-density=touch]]:text-[max(16px,1rem)]"
        />
      </TextField>
      <ListBox
        aria-label={QUICK_FIND}
        items={sections}
        // Heard on the way down, since a result's own press handling stops the event there.
        onPointerDownCapture={() => markPick(true)}
        onAction={(key) => {
          const item = byKey.get(String(key))
          if (item) run(item)
        }}
        renderEmptyState={() =>
          searched ? <p className="t-body text-ink-2 px-3 py-4 text-center">{NO_MATCHES}</p> : null
        }
        className="mt-2 min-h-0 flex-1 overflow-y-auto outline-none"
      >
        {(section) => (
          <ListBoxSection id={section.id} className="pb-2">
            <Header className="t-caption text-ink-2 px-3 py-1">
              {section.title ?? QUICK_FIND_SECTIONS[section.id]}
            </Header>
            <Collection items={section.items}>{(item) => <ResultRow item={item} />}</Collection>
          </ListBoxSection>
        )}
      </ListBox>
    </Autocomplete>
  )
}
