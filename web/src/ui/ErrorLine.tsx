/** Where an error line sits, which sets the space around it. */
export type ErrorPlace = 'bar' | 'field' | 'sheet' | 'inline' | 'title' | 'stack'

const PLACE: Record<ErrorPlace, string> = {
  /** Under a pane bar, over the rows. */
  bar: 'px-4 pb-2',
  /** Under a group of fields or a search field, on the rows' text edge. */
  field: 'px-4 pt-2',
  /** At the top of a sheet's form. */
  sheet: 'px-4 pt-3',
  /** Under a control in a page's own column, which already has its gutter. */
  inline: 'pt-2',
  /** Under a page title, pulled into the space the title leaves below it. */
  title: 'pb-6',
  /** Centered in a column whose gap spaces it, such as the recorder's or practice's. */
  stack: 'text-center',
}

// Outside the reveal, which clips what it holds, so a pull into the space above still shows.
const PULL: Partial<Record<ErrorPlace, string>> = { title: '-mt-4' }

/**
 * Why the last action failed, read out as it appears. It opens its own space and fades in, so
 * what sits below slides down rather than jumping. Nothing renders while there is none.
 */
export function ErrorLine({
  error,
  place,
  id,
}: {
  error: string | null | undefined
  place: ErrorPlace
  /** For a control that names the line with `aria-describedby`. */
  id?: string
}) {
  if (!error) return null
  return (
    <div
      className={`grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-(--dur-base) ease-(--ease) starting:grid-rows-[0fr] starting:opacity-0 ${PULL[place] ?? ''}`}
    >
      <div className="min-h-0 overflow-hidden">
        <p id={id} role="alert" className={`t-secondary text-danger ${PLACE[place]}`}>
          {error}
        </p>
      </div>
    </div>
  )
}
