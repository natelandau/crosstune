import { useEffect, useId, useRef, type ReactNode } from 'react'

/** A bottom sheet on phones and a centered dialog from the sm breakpoint, on the native modal dialog. */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
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
    >
      <div className="modal-box max-h-[85dvh] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <h2 id={titleId} className="mb-3 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit">Close</button>
      </form>
    </dialog>
  )
}
