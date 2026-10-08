import { useId, useRef } from 'react'
import { LINK_LIMITS } from '../../api/vocabulary'
import { ADD_LINK, LINK_FIELD, LINK_PLACEHOLDER, PASTE_LINK } from './pasteLinkCopy'
import { usePasteLink } from './usePasteLink'
import { CANCEL } from '../../ui/confirmCopy'
import { Group } from '../../ui/form/Group'
import { TextField } from '../../ui/form/TextField'
import { Sheet } from '../../ui/Sheet'
import { useEndOnClose } from '../../ui/useEndOnClose'

/** Pastes a link to a recording elsewhere onto a tune, as a part-height form. */
export function PasteLinkSheet({
  tuneId,
  isOpen,
  onOpenChange,
}: {
  tuneId: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const errorId = useId()
  const paste = usePasteLink(isOpen ? tuneId : null, {
    onClose: () => onOpenChange(false),
    onInvalid: () => fieldRef.current?.focus(),
  })

  useEndOnClose(paste.closing, paste.dismissed)

  const refusal = paste.validation ?? paste.error
  return (
    <Sheet
      isOpen={paste.open}
      onOpenChange={(open) => {
        if (!open) paste.close()
      }}
      title={PASTE_LINK}
      height="part"
      locked={paste.url.trim() !== '' || paste.pending}
      leading={{ label: CANCEL, onPress: paste.close, isDisabled: paste.pending }}
      primary={{
        label: ADD_LINK,
        onPress: paste.submit,
        isDisabled: paste.pending || paste.closing,
      }}
    >
      <form
        noValidate
        className="pb-4"
        onSubmit={(event) => {
          event.preventDefault()
          paste.submit()
        }}
      >
        <Group header={LINK_FIELD} error={refusal ?? undefined} errorId={errorId}>
          <TextField
            ref={fieldRef}
            standalone
            label={LINK_FIELD}
            placeholder={LINK_PLACEHOLDER}
            value={paste.url}
            maxLength={LINK_LIMITS.url}
            inputMode="url"
            enterKeyHint="done"
            isInvalid={paste.validation !== null}
            describedBy={refusal ? errorId : undefined}
            onChange={paste.setUrl}
          />
        </Group>
      </form>
    </Sheet>
  )
}
