import { useEffect, useId, useRef, type ReactNode } from 'react'

/** A bottom sheet on phones and a centered dialog from the sm breakpoint, on the native modal dialog. */
export function Sheet({
  open,
  title,
  onClose,
  children,
  dismissible = true,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** False keeps the sheet open through a backdrop click or Escape, for a choice the
   * caller's own controls must resolve. */
  dismissible?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.hasAttribute('open')) dialog.showModal()
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
        <h2 id={titleId} className="text-title mb-3">
          {title}
        </h2>
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
