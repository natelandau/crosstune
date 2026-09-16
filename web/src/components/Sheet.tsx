import { useEffect, useId, useRef, type ReactNode } from 'react'

/** A bottom sheet on phones and a centered dialog from the sm breakpoint, on the native modal dialog. */
export function Sheet({
  open,
  title,
  onClose,
  children,
  dismissible = true,
  action,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** False keeps the sheet open through a backdrop click or Escape, for a choice the
   * caller's own controls must resolve. */
  dismissible?: boolean
  action?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.hasAttribute('open')) {
      dialog.showModal()
      // The dialog's own focus delegate takes the first focusable element, which is whatever
      // sits in the header; a sheet that knows its subject names it instead.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && dialog.hasAttribute('open')) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="modal modal-bottom sm:modal-middle sheet"
      onClose={onClose}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault()
      }}
    >
      <div className="modal-box max-h-[85dvh] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center gap-3">
          <h2 id={titleId} className="text-title min-w-0 flex-1">
            {title}
          </h2>
          {action}
        </div>
        {children}
      </div>
      {dismissible ? (
        <form method="dialog" className="modal-backdrop">
          <button type="submit">Close</button>
        </form>
      ) : null}
    </dialog>
  )
}
