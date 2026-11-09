/**
 * Whether a sheet's primary is disabled: when it cannot go ahead, except while its own work runs,
 * when the button itself ignores presses and shows the work.
 */
export function primaryDisabled(canGoAhead: boolean, pending: boolean): boolean {
  return !canGoAhead && !pending
}
