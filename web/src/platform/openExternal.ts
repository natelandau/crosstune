/** Opens an outside page in a new tab that gets neither a handle back to this one nor a referrer. */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
