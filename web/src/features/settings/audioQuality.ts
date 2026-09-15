import type { AudioQuality } from '../../db/recordings'

export const QUALITY_LABELS: Record<AudioQuality, string> = {
  low: 'Low',
  standard: 'Standard',
  high: 'High',
}
