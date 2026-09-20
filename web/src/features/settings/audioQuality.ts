import { AUDIO_BITRATES, type AudioQuality } from '../../db/recordings'

const QUALITY_NAMES: Record<AudioQuality, string> = {
  low: 'Low',
  standard: 'Standard',
  high: 'High',
}

/** The rate is read from the preset itself, so changing one changes what the picker says. */
function label(quality: AudioQuality): string {
  return `${QUALITY_NAMES[quality]}, ${AUDIO_BITRATES[quality] / 1000} kbps`
}

export const QUALITY_LABELS: Record<AudioQuality, string> = {
  low: label('low'),
  standard: label('standard'),
  high: label('high'),
}
