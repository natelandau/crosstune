import { useMemo } from 'react'
import { instrumentsFrom } from './instruments'
import { useSettingsRow } from './useSettingsRow'
import type { Instrument } from '../../api/vocabulary'

/** The instruments the user plays, or undefined until the settings row has been read. */
export function useInstruments(): ReadonlySet<Instrument> | undefined {
  const row = useSettingsRow()
  return useMemo(() => (row === undefined ? undefined : instrumentsFrom(row)), [row])
}
