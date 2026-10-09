import { ChevronLeft, FolderOpen } from 'lucide-react'
import { Fragment, useLayoutEffect, useRef } from 'react'
import type { ImportEntry } from '../../usage/events'
import { LIST_LIMITS, TUNE_LIMITS } from '../../api/vocabulary'
import { GENRES } from '../../constants'
import { useStampedDensity } from '../../platform/density'
import { Button } from '../../ui/Button'
import { BACK, CANCEL } from '../../ui/confirmCopy'
import { ErrorLine } from '../../ui/ErrorLine'
import { Checkbox } from '../../ui/form/Checkbox'
import { Group } from '../../ui/form/Group'
import { Picker } from '../../ui/form/Picker'
import { StatusRail } from '../../ui/form/StatusRail'
import { SuggestField } from '../../ui/form/SuggestField'
import { TextField } from '../../ui/form/TextField'
import { Sheet } from '../../ui/Sheet'
import { useFileDrop } from '../../ui/useFileDrop'
import { LIST_NAME_LABEL } from '../lists/listsCopy'
import { TITLE_FIELD } from '../tune/tuneFormCopy'
import { ImportHelp } from './ImportHelp'
import {
  ALREADY_IN_CATALOG,
  CONTINUE,
  IMPORT_GENRE_LABEL,
  IMPORT_LIST_LABEL,
  IMPORT_STATUS_LABEL,
  IMPORT_TUNES,
  NEW_IMPORT_LIST,
  NO_IMPORT_LIST,
  OPEN_FILE,
  OVER_LIMIT_NOTE,
  PASTE_LABEL,
  PASTE_PLACEHOLDER,
  RECORDINGS_NOTE,
  SHORTENED_NOTE,
  addTunesLabel,
  includeLabel,
} from './importCopy'
import type { ImportRow } from './review'
import { NEW_LIST, useImport, type ImportSession } from './useImport'

/**
 * Imports a list of tunes: paste or open a text file, review one row per tune, then add the
 * checked rows in one write. Closes where it was opened, with a toast naming the count.
 */
export function ImportSheet({
  open,
  entry,
  onClosed,
}: {
  open: boolean
  entry: ImportEntry
  onClosed: () => void
}) {
  const session = useImport(open, entry)
  const { step, typed, pending } = session
  return (
    <Sheet
      isOpen={open && !session.closing}
      onOpenChange={(next) => {
        if (next) return
        // Locked once text is typed, so only a device back press reaches here then: it steps
        // back from the review, and keeps the typed text on the paste step.
        if (step === 'review') session.back()
        else if (!typed) session.close()
      }}
      title={IMPORT_TUNES}
      height="full"
      locked={typed || pending}
      asksOnBack={typed}
      leading={
        step === 'review'
          ? { label: BACK, icon: ChevronLeft, onPress: session.back, isDisabled: pending }
          : { label: CANCEL, onPress: session.close }
      }
      primary={
        step === 'review'
          ? {
              label: addTunesLabel(session.count),
              onPress: session.add,
              isDisabled: !session.canAdd,
            }
          : { label: CONTINUE, onPress: session.review, isDisabled: !session.canContinue }
      }
      onClosed={onClosed}
    >
      {step === 'paste' ? <PasteStep session={session} /> : <ReviewStep session={session} />}
    </Sheet>
  )
}

function PasteStep({ session }: { session: ImportSession }) {
  const pointer = useStampedDensity() === 'pointer'
  const drop = useFileDrop(pointer ? session.openFiles : undefined)
  return (
    <div
      {...drop.handlers}
      className={`rounded-(--radius-surface) ${drop.over ? 'ring-slate ring-2' : ''}`}
    >
      <Group>
        <TextField
          standalone
          multiline
          rows={10}
          label={PASTE_LABEL}
          placeholder={PASTE_PLACEHOLDER}
          value={session.text}
          onChange={session.setText}
          autoFocus
        />
      </Group>
      <div className="pt-2">
        <OpenFileControl onFiles={session.openFiles} />
      </div>
      <ErrorLine error={session.error} place="field" />
      <ImportHelp />
      <p className="t-secondary text-ink-2 px-4 pt-2">{RECORDINGS_NOTE}</p>
    </div>
  )
}

function OpenFileControl({ onFiles }: { onFiles: (files: File[]) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button icon={FolderOpen} label={OPEN_FILE} onPress={() => picker.current?.click()} />
      {/* The native picker cannot be styled, so it hides behind the button, out of the tab
          order and the tree, which the button already names. */}
      <input
        ref={picker}
        type="file"
        accept=".txt"
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </>
  )
}

function ReviewStep({ session }: { session: ImportSession }) {
  // Focus leaves the primary, which is now Add, so a second Enter meant for Continue lands on
  // nothing, and a screen reader hears that the sheet's content changed.
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => heading.current?.focus({ preventScroll: true }), [])
  return (
    <>
      <ErrorLine error={session.error} place="sheet" />
      <Group header={IMPORT_STATUS_LABEL} headerRef={heading} plain>
        <StatusRail
          label={IMPORT_STATUS_LABEL}
          value={session.status}
          onChange={session.setStatus}
        />
      </Group>
      <Group>
        <SuggestField
          label={IMPORT_GENRE_LABEL}
          value={session.genre}
          suggestions={GENRES}
          maxLength={TUNE_LIMITS.genre}
          onChange={session.setGenre}
        />
        <Picker
          label={IMPORT_LIST_LABEL}
          value={session.listKey}
          emptyLabel={NO_IMPORT_LIST}
          options={[
            { id: NEW_LIST, label: NEW_IMPORT_LIST },
            ...session.lists.map((list) => ({ id: list.id, label: list.name })),
          ]}
          onChange={session.setListKey}
        />
        {session.listKey === NEW_LIST && (
          <TextField
            label={LIST_NAME_LABEL}
            value={session.listName}
            maxLength={LIST_LIMITS.name}
            onChange={session.setListName}
          />
        )}
      </Group>
      {session.dropped > 0 && <p className="t-secondary text-ink-2 px-4 pt-4">{OVER_LIMIT_NOTE}</p>}
      {session.showsHelp && <ImportHelp />}
      {session.rows.length > 0 && (
        <Group>
          {session.rows.map((row) => (
            <ReviewRow key={row.key} row={row} session={session} />
          ))}
        </Group>
      )}
    </>
  )
}

function ReviewRow({ row, session }: { row: ImportRow; session: ImportSession }) {
  const title = row.title.trim()
  const notes = [
    ...(row.source !== title ? [row.source] : []),
    ...(row.duplicate && title !== '' ? [ALREADY_IN_CATALOG] : []),
    ...(row.warnings.includes('shortened') ? [SHORTENED_NOTE] : []),
  ]
  return (
    <div className="flex items-start ps-1">
      <Checkbox
        label={includeLabel(title || row.source)}
        isSelected={row.included}
        onChange={(included) => session.setIncluded(row.key, included)}
      />
      <div className="min-w-0 flex-1">
        <TextField
          standalone
          label={TITLE_FIELD}
          value={row.title}
          maxLength={TUNE_LIMITS.title}
          onChange={(value) => session.setTitle(row.key, value)}
        />
        {notes.length > 0 && (
          <p className="t-secondary text-ink-2 -mt-2 ps-4 pe-4 pb-2 break-words">
            {notes.map((note, index) => (
              <Fragment key={note}>
                {index > 0 && <span aria-hidden> · </span>}
                <span>{note}</span>
              </Fragment>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}
