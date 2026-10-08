import { useMemo } from 'react'
import type { Instrument } from '../../api/vocabulary'
import { instrumentsFrom } from './instruments'
import { useSettingsRow } from './useSettingsRow'

/** The instruments the user plays, or undefined until the settings row has been read. */
export function useInstruments(enabled = true): ReadonlySet<Instrument> | undefined {
  const row = useSettingsRow(enabled)
  return useMemo(() => (row === undefined ? undefined : instrumentsFrom(row)), [row])
}
