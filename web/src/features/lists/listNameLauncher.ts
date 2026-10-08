import { createContext, useContext } from 'react'

export interface ListNameLauncher {
  /** Opens the list name sheet for a new list, over whatever screen shows. */
  open: () => void
}

const NOTHING: ListNameLauncher = { open: () => {} }

/** Provided beside the router; until it is mounted, asking for a new list does nothing. */
export const ListNameLauncherContext = createContext<ListNameLauncher>(NOTHING)

export function useListNameLauncher(): ListNameLauncher {
  return useContext(ListNameLauncherContext)
}
