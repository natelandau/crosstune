/**
 * The text a control reads after its name, such as why it is off: hidden, and named by the
 * control's `aria-describedby`, which is `descriptionProps` of the same id and text.
 */
export function ControlDescription({ id, text }: { id: string; text: string | undefined }) {
  return text ? (
    <span id={id} hidden>
      {text}
    </span>
  ) : null
}

/** The control's side of `ControlDescription`. */
// eslint-disable-next-line react-refresh/only-export-components
export function descriptionProps(id: string, text: string | undefined) {
  return { 'aria-describedby': text ? id : undefined }
}
