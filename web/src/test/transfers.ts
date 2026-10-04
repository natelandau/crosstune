import type { SyncEngine } from '../sync/types'

/** Resolves once the transfer loop a sync started has finished its pass. */
export function transfersSettled(engine: SyncEngine): Promise<void> {
  if (engine.transferStatus() !== 'transferring') return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = engine.subscribeTransfer((status) => {
      if (status === 'transferring') return
      unsubscribe()
      resolve()
    })
  })
}
