import { createContext } from 'react'

/**
 * True inside a section heading's trailing controls, where a plain button takes the accent even
 * as a glyph alone, as Apple's section-heading controls do.
 */
export const InSectionHeading = createContext(false)
