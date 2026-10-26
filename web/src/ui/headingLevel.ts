import { createContext, useContext } from 'react'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/**
 * The level of the heading over this part of the tree: a page's title is 1, a sheet's title or a
 * page section's heading 2. A heading nested under it takes `useSubheadingLevel`, so levels
 * never skip whether a group sits on a page or in a sheet.
 */
export const HeadingLevelContext = createContext<HeadingLevel>(1)

/** The level for a heading one step under the enclosing one. */
export function useSubheadingLevel(): HeadingLevel {
  return Math.min(useContext(HeadingLevelContext) + 1, 6) as HeadingLevel
}
