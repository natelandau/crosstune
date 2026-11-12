import { addedDay } from '../../text/format'
import { DATE_ADDED } from './attributesCopy'

/** The quiet line that ends an item's attributes: the day it was added, which nothing edits. */
export function DateAddedLine({ at, className }: { at: string; className: string }) {
  return (
    <p className={`t-caption text-secondary font-normal ${className}`}>
      {DATE_ADDED(addedDay(at))}
    </p>
  )
}
