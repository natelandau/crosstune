import type { Source } from '../../usage/events'

/** What a navigation to the new-tune page carries: where the musician offered it. */
export interface NewTuneState {
  source: Extract<Source, 'catalog' | 'menu'>
}

export function newTuneState(source: NewTuneState['source']): NewTuneState {
  return { source }
}

/** The source a location's state names, `catalog` when it names none. */
export function newTuneSource(state: unknown): NewTuneState['source'] {
  const source = (state as Partial<NewTuneState> | null)?.source
  return source === 'menu' ? 'menu' : 'catalog'
}
