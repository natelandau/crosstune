import { useState } from 'react'
import { TUNE_LIMITS } from '../../api/vocabulary'
import { LYRICS_PLACEHOLDER } from '../tune/tuneFormCopy'
import { LYRICS_SECTION } from '../tune/tuneScreenCopy'
import { DONE } from '../../ui/confirmCopy'
import { Group } from '../../ui/form/Group'
import { TextField } from '../../ui/form/TextField'
import { Sheet } from '../../ui/Sheet'

/**
 * The whole lyrics body, at the height a body needs. Done hands the words to whoever opened
 * the sheet rather than writing them: the tune form keeps them until it is saved, so cancelling
 * the form discards them with everything else, and the reader writes them on their own. A
 * caller that writes passes `pending` and `error` and closes the sheet once the write lands,
 * so refused words stay in the box.
 */
export function LyricsEditor({
  value,
  onSave,
  isOpen,
  onOpenChange,
  error,
  pending = false,
}: {
  value: string
  onSave: (value: string) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** A refused write, shown under the box. */
  error?: string | null
  /** True while a caller's write is in flight. */
  pending?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [opened, setOpened] = useState(false)
  // Reset during render, so the sheet's first frame already holds the current words.
  if (isOpen && !opened) {
    setOpened(true)
    setDraft(value)
  }
  if (!isOpen && opened) setOpened(false)
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={LYRICS_SECTION}
      height="full"
      locked={draft !== value || pending}
      primary={{ label: DONE, onPress: () => onSave(draft), isDisabled: pending }}
    >
      {/* The sheet's title already names the field, so a header would only repeat it. */}
      <Group error={error ?? undefined}>
        <TextField
          standalone
          multiline
          rows={16}
          label={LYRICS_SECTION}
          placeholder={LYRICS_PLACEHOLDER}
          value={draft}
          maxLength={TUNE_LIMITS.lyrics}
          onChange={setDraft}
        />
      </Group>
    </Sheet>
  )
}
