/** What a confirmation asks; `useConfirm` accepts at least this. */
export interface ConfirmQuestion {
  title: string
  message: string
  /** The confirming button's label, a bare verb: Delete. */
  action: string
  /** Aborted when the question no longer applies. An app that can withdraw an open dialog does,
   * answering no; one that cannot ignores it. */
  signal?: AbortSignal
}
