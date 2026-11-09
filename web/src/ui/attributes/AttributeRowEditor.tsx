import { useRef, type ReactNode, type Ref } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { FIELD_LABEL, FIELD_VALUE_SHAPE } from '../form/FieldRow'
import { ROW_PRESS } from '../press'
import { AttributeEditor, type AttributeEditorFrame, type PatchSave } from './AttributeEditor'

const ROW_LAYOUT = 'flex min-h-(--target) w-full items-center gap-3 px-4 text-start t-body'
export const ROW_SHAPE = `${ROW_PRESS} ${ROW_LAYOUT}`
/**
 * A row in the attributes column: inset, so its tint reads as a rounded shape on the open page. A
 * narrow column sets the label over its value, so the value has the full width, and the two lines
 * clear the row's target height. A wide one sets the value at the trailing edge, on the label's
 * first baseline, with the padding centering a single line in the target height.
 */
const COLUMN_ROW_LAYOUT =
  'mx-2 flex flex-col gap-px rounded-(--radius) px-2 py-1.5 text-start t-body @attributes-wide:min-h-(--target) @attributes-wide:flex-row @attributes-wide:items-baseline @attributes-wide:gap-3 @attributes-wide:py-[calc((var(--target)_-_1.45em)/2)]'
const COLUMN_ROW_SHAPE = `${ROW_PRESS} ${COLUMN_ROW_LAYOUT}`
/** Beside its value, the label takes `t-secondary`'s step. */
const COLUMN_LABEL =
  't-caption text-secondary font-normal break-words @attributes-wide:min-w-0 @attributes-wide:flex-1 @attributes-wide:text-(length:--size-secondary)'
const COLUMN_VALUE =
  'leading-[1.35] break-words @attributes-wide:max-w-[62%] @attributes-wide:text-end'

interface RowFace {
  label: string
  /** Null when there is no value, which shows `emptyText`. */
  text: string | null
  emptyText: string
  /** Two wrapping columns on a rounded row, rather than the card's grouped row. */
  column: boolean
}

function RowText({ label, text, emptyText, column }: RowFace) {
  const valueTone =
    text === null ? 'text-secondary' : column ? 'text-primary t-num font-medium' : 'text-primary'
  return (
    <>
      <span className={column ? COLUMN_LABEL : FIELD_LABEL}>{label}</span>
      <span className={`${column ? COLUMN_VALUE : FIELD_VALUE_SHAPE} ${valueTone}`}>
        {text ?? emptyText}
      </span>
    </>
  )
}

/** A row that cannot be edited: its label and value as text, with no press or disclosure. */
export function ReadOnlyRow(face: RowFace) {
  return (
    <div
      role="group"
      aria-label={`${face.label}, ${face.text ?? face.emptyText}`}
      className={face.column ? COLUMN_ROW_LAYOUT : ROW_LAYOUT}
    >
      <RowText {...face} />
    </div>
  )
}

/** A row that opens an editor on press: its label and value, named as one. */
export function AttributeRowButton({
  ref,
  onPress,
  ...face
}: RowFace & { ref?: Ref<HTMLButtonElement>; onPress: () => void }) {
  return (
    <AriaButton
      ref={ref}
      aria-label={`${face.label}, ${face.text ?? face.emptyText}`}
      aria-haspopup="dialog"
      onPress={onPress}
      className={face.column ? COLUMN_ROW_SHAPE : ROW_SHAPE}
    >
      <RowText {...face} />
    </AriaButton>
  )
}

/**
 * A row that opens its editor on press, and the editor, kept mounted and driven by `isOpen` so
 * its surface animates in and out; its body mounts only while it shows.
 */
export function AttributeRowEditor<P extends object>({
  label,
  text,
  emptyText,
  isOpen,
  column,
  onOpen,
  editor,
  children,
}: RowFace & {
  isOpen: boolean
  onOpen: () => void
  editor: Omit<AttributeEditorFrame, 'label' | 'triggerRef' | 'isOpen' | 'children'> & PatchSave<P>
  children: ReactNode
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <AttributeRowButton
        ref={trigger}
        label={label}
        text={text}
        emptyText={emptyText}
        column={column}
        onPress={onOpen}
      />
      <AttributeEditor {...editor} label={label} triggerRef={trigger} isOpen={isOpen}>
        {children}
      </AttributeEditor>
    </>
  )
}
