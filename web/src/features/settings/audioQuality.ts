import type { AudioQuality } from '../../api/vocabulary'
import { AUDIO_BITRATES, AUDIO_QUALITY_NAMES } from '../../constants'

/** The rate is read from the preset itself, so changing one changes what the picker says. */
function label(quality: AudioQuality): string {
  return `${AUDIO_QUALITY_NAMES[quality]}, ${AUDIO_BITRATES[quality] / 1000} kbps`
}

export const QUALITY_LABELS: Record<AudioQuality, string> = {
  low: label('low'),
  standard: label('standard'),
  high: label('high'),
}
