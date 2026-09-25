import { MODES, type Mode } from '../../api/vocabulary'
import { MODE_ABBREVIATIONS } from '../../constants'

const isMode = (value: string | undefined): value is Mode =>
  (MODES as readonly string[]).includes(value ?? '')

/** A key and mode as a row shows them, and as a screen reader should hear them. */
export function keyModeLabel(
  key: string,
  mode: string | undefined,
): { suffix: string; spoken: string } {
  if (!isMode(mode) || mode === 'other') return { suffix: '', spoken: key }
  return { suffix: MODE_ABBREVIATIONS[mode], spoken: `${key} ${mode}` }
}
