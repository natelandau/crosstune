import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { QuickFindCommand } from '../features/quickFind/quickFindResults'
import { SORT_BY, sortMenuChoices } from '../ui/sortCopy'
import type { SortChoice } from '../ui/sortChoice'
import type { SortOptions } from '../ui/sortTypes'
import { useLatest } from '../ui/useLatest'

type Read = () => QuickFindCommand

export interface ScreenCommands {
  /** Offers the command `read` returns until the returned function withdraws it. */
  register: (read: Read) => () => void
  subscribe: (onChange: () => void) => () => void
  /** The readers held, oldest first. */
  held: () => readonly Read[]
}

function createScreenCommands(): ScreenCommands {
  let held: readonly Read[] = []
  const listeners = new Set<() => void>()
  const change = (next: readonly Read[]) => {
    held = next
    for (const listener of listeners) listener()
  }
  return {
    register(read) {
      change([...held, read])
      return () => change(held.filter((other) => other !== read))
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    held: () => held,
  }
}

// One array, since `useSyncExternalStore` renders again whenever the snapshot is a new one.
const NOTHING_HELD: readonly Read[] = []

const NONE: ScreenCommands = {
  register: () => () => {},
  subscribe: () => () => {},
  held: () => NOTHING_HELD,
}

const ScreenCommandsContext = createContext<ScreenCommands>(NONE)

/** Holds the commands the showing screens offer Quick Find. */
export function ScreenCommandsProvider({ children }: { children: ReactNode }) {
  const [commands] = useState(createScreenCommands)
  return createElement(ScreenCommandsContext.Provider, { value: commands }, children)
}

/**
 * Offers `command` in Quick Find while `active`, such as while its screen shows and is not
 * selecting. Quick Find reads the latest render's command, so its state, such as the current
 * sort, never goes stale.
 */
export function useScreenCommand(command: QuickFindCommand, active: boolean): void {
  const { register } = useContext(ScreenCommandsContext)
  const commandRef = useLatest(command)
  useEffect(() => {
    if (!active) return
    return register(() => commandRef.current)
  }, [active, register, commandRef])
}

/** The commands the showing screens offer, in the order they offered them. */
export function useScreenCommands(): QuickFindCommand[] {
  const commands = useContext(ScreenCommandsContext)
  return useSyncExternalStore(commands.subscribe, commands.held).map((read) => read())
}

/** Sort by, whose second step offers a screen's sorts as its Sort menu does. */
export function sortCommand<S extends string>(
  options: SortOptions<S>,
  choice: SortChoice<S>,
  setSort: (next: SortChoice<S>) => void,
): QuickFindCommand {
  return {
    id: 'sortBy',
    label: SORT_BY,
    step: {
      title: SORT_BY,
      choices: sortMenuChoices(options, choice).map((one) => ({
        id: one.sort,
        label: one.label,
        description: one.description,
        run: () => setSort(one.next),
      })),
    },
  }
}
