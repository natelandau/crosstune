/** Ask the browser to keep this origin's storage out of eviction. A refusal is silent: nothing the app can do about it. */
export function persistStorage(): void {
  void navigator.storage?.persist?.().catch(() => {})
}
