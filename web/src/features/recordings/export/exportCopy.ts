import type { ExportBlock } from './readiness'

export const SHARE = 'Share'

export const TRY_AGAIN = 'Try again'

export const EXPORT_BLOCK_REASONS: Record<ExportBlock, string> = {
  capturing: 'Recording in progress',
  not_ready: 'Still processing',
  offline: 'Not on this device. Go online to download it.',
}

export const exportSkipped = (skipped: number, selected: number) =>
  skipped === 1
    ? `1 of ${selected} recordings can't be exported. It is still recording, still processing, or not on this device while offline.`
    : `${skipped} of ${selected} recordings can't be exported. They are still recording, still processing, or not on this device while offline.`

export const exportLeftOut = (failed: number) =>
  failed === 1
    ? '1 recording could not be downloaded and was left out.'
    : `${failed} recordings could not be downloaded and were left out.`
