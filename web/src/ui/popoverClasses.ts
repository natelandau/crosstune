/** A floating surface that grows from its trigger, such as a menu or a popover dialog. */
export const POPOVER_SURFACE = 'popover-surface bg-page rounded-(--radius) shadow-(--shadow-float)'

/** The list a picker or a suggest field opens under its field, shown at once with no growth. */
export const LISTBOX_SURFACE =
  'bg-page max-h-80 min-w-48 overflow-y-auto rounded-(--radius) p-1 shadow-(--shadow-float)'

/** One option in a menu or a list of choices, filled while it has focus. */
export const OPTION_ROW =
  't-body data-[focused]:bg-field flex min-h-(--target) cursor-default items-center gap-3 rounded-(--radius-item) px-3 py-1'
