import { useStorage } from '../../db/useStorage'
import type { UploadLimits } from '../../domain/recordingLimits'

/** The server's per-file upload caps, or null until it has reported them. */
export function useUploadLimits(): UploadLimits | null {
  return useStorage() ?? null
}
