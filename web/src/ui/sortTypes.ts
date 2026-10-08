/** What a screen's Sort menu offers: its sorts in menu order, their names, and which are dates. */
export interface SortOptions<S extends string> {
  sorts: readonly S[]
  labels: Record<S, string>
  isDate: (sort: S) => boolean
}
