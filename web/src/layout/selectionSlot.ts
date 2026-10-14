import { createContext } from 'react'

/** Where the phone's selection bar goes: the tab bar's place, which it takes while selecting. */
export const SelectionSlot = createContext<HTMLElement | null>(null)
