import { createContext, useContext } from 'react'
import type { CreateTuneOptions } from './useCreateTune'

/**
 * Creates a tune with the "Added" toast and its Undo; resolves to the new tune's id. It files the
 * tune nowhere, since the toast has no room for a filing's refusal.
 */
export type AddTune = (options: Pick<CreateTuneOptions, 'title' | 'source'>) => Promise<string>

export const AddTuneContext = createContext<AddTune | null>(null)

/** The catalog's create-with-Undo, which outlives the page that asked for it. */
export function useAddTune(): AddTune {
  const addTune = useContext(AddTuneContext)
  if (!addTune) throw new Error('useAddTune needs an AddTuneProvider')
  return addTune
}
