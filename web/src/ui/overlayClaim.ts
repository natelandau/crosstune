import { useContext, useSyncExternalStore } from 'react'
import { OverlayTriggerStateContext } from 'react-aria-components'
// The instance React Aria Components itself reads, so a react-aria upgrade must keep this path.
import { useIsHidden } from 'react-aria/private/collections/Hidden'
import {
  readBackEntries,
  resetBackEntriesForTest,
  subscribeBackEntries,
  useBackEntry,
} from '../app/backEntries'

export interface OverlayClaimOptions {
  coversShell?: boolean
  active?: boolean
  /** Closes the overlay on a device back press, as Escape or Cancel would. */
  close: () => void | Promise<void>
  /** False refuses a device back press, as a locked sheet refuses Escape. */
  dismissable?: boolean
}

/**
 * Claims that an overlay is open while `active`, the one signal every overlay sets, by holding
 * an overlay entry on the app's back stack. Returns whether this claim is the latest one still
 * held, so the overlay is the one on top. A tooltip stands down while any claim holds, because
 * an open tooltip takes Escape on the document before the overlay can hear it. A claim that
 * `coversShell`, such as a sheet or dialog, also stands the Record controls and the menu
 * commands down; a popover at its control does not. Claims count, because an exiting overlay
 * and its successor can briefly both be mounted.
 */
export function useOverlayClaim({
  coversShell = false,
  active = true,
  close,
  dismissable = true,
}: OverlayClaimOptions): () => boolean {
  return useBackEntry({ layer: 'overlay', back: close, dismissable, coversShell }, active)
}

/**
 * `isTop` from `useOverlayClaim` as state, so an overlay can wait for whatever it stacked over,
 * such as a menu or a confirm, to let go before it moves focus.
 */
export function useOnTop(isTop: () => boolean): boolean {
  return useSyncExternalStore(subscribeBackEntries, isTop)
}

/**
 * A claim as a component, for overlay content that renders only while its overlay is open.
 * Inside a React Aria trigger, such as a select's or a combo box's, back closes it through the
 * trigger unless `close` is given.
 */
export function OverlayClaim({
  coversShell = false,
  close,
}: {
  coversShell?: boolean
  close?: () => void
}): null {
  const trigger = useContext(OverlayTriggerStateContext)
  // React Aria also renders a select's or combo box's popover content, closed, in a hidden tree
  // that builds its collection; a claim there would hold for as long as the field is mounted.
  const hidden = useIsHidden()
  if (import.meta.env.DEV && !hidden && !close && !trigger) {
    throw new Error('OverlayClaim needs a close or a React Aria trigger, or back goes dead')
  }
  useOverlayClaim({ coversShell, active: !hidden, close: close ?? (() => trigger?.close()) })
  return null
}

const overlayOpen = () => readBackEntries().some((entry) => entry.layer === 'overlay')
const shellCovered = () =>
  readBackEntries().some((entry) => entry.layer === 'overlay' && entry.coversShell)

/** Whether any overlay holds a claim. */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(subscribeBackEntries, overlayOpen)
}

/** Whether a sheet, dialog, or other claim that covers the shell holds. */
export function useShellCovered(): boolean {
  return useSyncExternalStore(subscribeBackEntries, shellCovered)
}

/** Forgets every claim and screen state, so no test inherits one another test left behind. */
export function resetOverlayClaimsForTest(): void {
  resetBackEntriesForTest()
}
