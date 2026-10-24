import { createContext } from 'react'

/**
 * True inside a bar (a pane bar, the root bar, a selection bar), where a labeled button keeps
 * the bar's round shape rather than the control corner content buttons take.
 */
export const InBar = createContext(false)
