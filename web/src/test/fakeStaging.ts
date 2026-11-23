import { vi } from 'vitest'
import type { ExportStaging } from '../features/settings/export/staging'

/** A staging whose reader stores nothing and whose discard a test can watch, with the opener
 * an export takes as its `openStaging` option. */
export function fakeStaging() {
  const staging = {
    stage: vi.fn(async (response: Response) => response.blob()),
    discard: vi.fn(async () => {}),
  } satisfies ExportStaging
  return { staging, openStaging: vi.fn(async (_plannedBytes: number) => staging) }
}
