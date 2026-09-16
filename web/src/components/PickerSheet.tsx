import { HelpText } from './Page'
import { ChoiceChips } from './ChoiceChips'
import { Sheet } from './Sheet'

/** A single-field picker: a chip tap sets the value and closes the sheet. */
export function PickerSheet({
  open,
  title,
  value,
  options,
  onChange,
  onClose,
  other = false,
  maxLength,
}: {
  open: boolean
  title: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  onClose: () => void
  other?: boolean
  maxLength?: number
}) {
  return (
    <Sheet
      open={open}
      title={title}
      onClose={onClose}
      action={
        value ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm min-h-11"
            onClick={() => {
              onChange('')
              onClose()
            }}
          >
            Clear
          </button>
        ) : null
      }
    >
      <ChoiceChips
        // Remounting on each open drops any Other input left behind, so the sheet opens on chips.
        key={open ? 'open' : 'closed'}
        label={title}
        value={value}
        options={options}
        other={other}
        maxLength={maxLength}
        autoFocusPressed
        onChange={onChange}
        onCommit={onClose}
      />
      {other ? (
        <button type="button" className="btn mt-4 min-h-11 w-full" onClick={onClose}>
          Done
        </button>
      ) : null}
    </Sheet>
  )
}

export function TextSheet({
  open,
  title,
  value,
  onChange,
  onClose,
  maxLength,
  help,
}: {
  open: boolean
  title: string
  value: string
  onChange: (value: string) => void
  onClose: () => void
  maxLength?: number
  help?: string
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          onClose()
        }}
      >
        <label className="input w-full">
          <input
            className="grow"
            aria-label={title}
            // The row tap that opened the sheet is a request to type here.
            data-autofocus
            maxLength={maxLength}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        {help ? <HelpText>{help}</HelpText> : null}
        <button type="submit" className="btn btn-primary min-h-11 w-full">
          Done
        </button>
      </form>
    </Sheet>
  )
}
