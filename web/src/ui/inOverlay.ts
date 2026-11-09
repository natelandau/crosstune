import { createContext } from 'react'

/**
 * True inside a sheet or popover. Both are phone width at most, so controls inside take their
 * compact touch layout on any device.
 */
export const InOverlay = createContext(false)
