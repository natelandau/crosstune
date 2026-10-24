import { useState } from 'react'
import { Button } from '../../ui/Button'
import { ErrorLine } from '../../ui/ErrorLine'
import type { MenuItem } from '../../ui/menuTypes'
import { useResetOnChange } from '../../ui/useResetOnChange'
import {
  FIND_A_RECORDING,
  FIRST_RECORDING_HINT,
  FIRST_RECORDING_TITLE,
  PASTE_LINK,
  RECORD,
} from './tuneMediaCopy'

/**
 * An empty Recordings section's start card, the one way to add while there is nothing in it:
 * record, paste a link, or find one. Find goes where the add menu's Find goes, and refuses on
 * tap while it needs a connection.
 */
export function FirstRecordingCard({
  recordAvailable,
  find,
  onRecord,
  onPaste,
}: {
  recordAvailable: boolean
  find: MenuItem
  onRecord: () => void
  onPaste: () => void
}) {
  // The reason follows the item, so it clears once the connection is back.
  const [pressed, setPressed] = useState(false)
  useResetOnChange(find.refused === undefined, () => setPressed(false))
  return (
    <div className="flex flex-col gap-3 rounded-(--radius-surface) border-[1.5px] border-dashed border-[color-mix(in_srgb,var(--color-ink)_22%,transparent)] p-5">
      <h3 className="t-heading">{FIRST_RECORDING_TITLE}</h3>
      <p className="t-secondary text-ink-2">{FIRST_RECORDING_HINT}</p>
      <div className="flex flex-wrap gap-2">
        {recordAvailable && (
          <Button
            variant="tinted"
            glyph={<span aria-hidden className="bg-record size-3 shrink-0 rounded-full" />}
            label={RECORD}
            onPress={onRecord}
          />
        )}
        <Button variant="tinted" label={PASTE_LINK} onPress={onPaste} />
        <Button
          variant="tinted"
          label={FIND_A_RECORDING}
          onPress={() => {
            setPressed(true)
            if (find.refused === undefined) find.onPress()
          }}
        />
      </div>
      <ErrorLine error={pressed ? find.refused : null} place="inline" />
    </div>
  )
}
