import type { ReactNode } from 'react'

/** A field row's shape without its inset, for a row that spends the inset on its parts. */
export const FIELD_ROW_BARE = 'flex min-h-(--size-row) w-full items-center gap-3 text-start t-body'
/** A field row's shape, for a control that is itself the row, such as a picker's trigger. */
export const FIELD_ROW = `${FIELD_ROW_BARE} px-4`
/** A row holding one text button, inset so the button's text lines up with the labels above. */
export const TEXT_BUTTON_ROW = `${FIELD_ROW_BARE} ps-1.5 pe-4`
/** A row's tint under the pointer, and a deeper tint while pressed. Tints show on any card. */
export const ROW_HOVER =
  'transition-colors duration-(--dur-short) ease-(--ease) hover:bg-tint-subtle data-[pressed]:bg-tint has-data-[pressed]:bg-tint'
/** A field row that is itself a control, such as a picker's trigger. */
export const FIELD_ROW_PRESSABLE = `${FIELD_ROW} cursor-default ${ROW_HOVER} disabled:hover:bg-transparent data-[disabled]:hover:bg-transparent`
export const FIELD_LABEL = 'shrink-0'
/** The trailing value's shape, which elides before the label shrinks. */
export const FIELD_VALUE_SHAPE = 'min-w-0 flex-1 truncate text-end'
/** The trailing value of a row that only reads. */
const FIELD_VALUE = `${FIELD_VALUE_SHAPE} text-secondary`

/** A labeled row: the label leads, and the value or a control trails. */
export function FieldRow({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: ReactNode
}) {
  return (
    <div className={FIELD_ROW}>
      <span className={FIELD_LABEL}>{label}</span>
      {value !== undefined && <span className={FIELD_VALUE}>{value}</span>}
      {children}
    </div>
  )
}
