import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface ChoiceChipsProps {
  /** Names the group for assistive tech. */
  label: string
  /** '' means nothing chosen. */
  value: string
  options: readonly string[]
  /** The text on an option's chip, when the value itself is not the label. */
  optionLabel?: (option: string) => string
  onChange: (value: string) => void
  /**
   * A tap that settles the value: an option chip, the empty chip, or the pressed custom chip.
   * Typing in the Other input and opening Other… never settle anything, so neither fires this.
   */
  onCommit?: (value: string) => void
  /** A leading chip that stands for '' (for example "All" or "Any"). */
  emptyOption?: string
  /** Offer an Other… chip that reveals a text input for a value not in options. */
  other?: boolean
  maxLength?: number
  /** One horizontally scrolling row instead of a wrapping one. */
  rail?: boolean
  /** Marks the pressed chip, or the first chip when none is pressed, for a dialog to focus. */
  autoFocusPressed?: boolean
}

const CHIP = 'btn min-h-11 rounded-full px-3.5 font-medium tabular-nums'

/** A label above a chip group, matching the label of a field that holds a real control. */
export function ChipsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-label">{label}</p>
      {children}
    </div>
  )
}

function Chip({
  pressed,
  autoFocus = false,
  onClick,
  children,
}: {
  pressed: boolean
  autoFocus?: boolean
  onClick: () => void
  children: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  // A rail can start scrolled past the pressed chip; bring it into view once on mount.
  useEffect(() => {
    if (pressed) ref.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <button
      ref={ref}
      type="button"
      className={`${CHIP} ${pressed ? 'btn-primary' : ''}`}
      aria-pressed={pressed}
      data-autofocus={autoFocus ? '' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function ChoiceChips({
  label,
  value,
  options,
  optionLabel = (option) => option,
  onChange,
  onCommit,
  emptyOption,
  other = false,
  maxLength,
  rail = false,
  autoFocusPressed = false,
}: ChoiceChipsProps) {
  const [editing, setEditing] = useState(false)
  const isOption = options.includes(value)
  const custom = value !== '' && !isOption
  const settle = (next: string) => {
    onChange(next)
    onCommit?.(next)
  }
  const toggle = (option: string) => settle(value === option ? '' : option)

  // Chip identities for the focus mark, prefixed so an option can never collide with the others.
  const first = emptyOption !== undefined ? 'empty' : options[0] ? `option:${options[0]}` : null
  let focused: string | null = null
  if (autoFocusPressed) {
    if (emptyOption !== undefined && value === '') focused = 'empty'
    else if (isOption) focused = `option:${value}`
    else if (custom && !editing) focused = 'custom'
    else focused = first
  }

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label={label}
        className={
          rail
            ? // Bleeds to the screen edge so the first chip aligns with the content and the last fades out.
              '-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto [mask-image:linear-gradient(90deg,#000_calc(100%-1.75rem),transparent)] px-4 pb-0.5'
            : 'flex flex-wrap gap-2'
        }
      >
        {emptyOption !== undefined ? (
          <Chip pressed={value === ''} autoFocus={focused === 'empty'} onClick={() => settle('')}>
            {emptyOption}
          </Chip>
        ) : null}
        {options.map((option) => (
          <Chip
            key={option}
            pressed={value === option}
            autoFocus={focused === `option:${option}`}
            onClick={() => toggle(option)}
          >
            {optionLabel(option)}
          </Chip>
        ))}
        {custom && !editing ? (
          <Chip pressed autoFocus={focused === 'custom'} onClick={() => settle('')}>
            {value}
          </Chip>
        ) : null}
        {other && !editing ? (
          <Chip
            pressed={false}
            onClick={() => {
              // Tapping Other… on a suggested option is a rejection of it, so typing starts
              // clean; a custom value already in progress stays for further editing.
              if (value !== '' && !custom) onChange('')
              setEditing(true)
            }}
          >
            Other…
          </Chip>
        ) : null}
      </div>
      {editing ? (
        <label className="input w-full">
          <input
            className="grow"
            aria-label={`Other ${label.toLowerCase()}`}
            // The Other… tap is the user's request to type, and this input mounts on that tap.
            autoFocus
            maxLength={maxLength}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setEditing(false)
              }
            }}
          />
        </label>
      ) : null}
    </div>
  )
}
