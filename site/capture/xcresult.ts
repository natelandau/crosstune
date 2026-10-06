/** What one capture left in the export folder; file names are relative to that folder. */
export type Found = { timeline: string; video?: string; recordingStart?: number; still?: string }

type Attachment = {
  exportedFileName: string
  suggestedHumanReadableName: string
  timestamp: number
}
type Test = { attachments: Attachment[]; testIdentifier: string }

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Finds each capture's files in an `xcresulttool export attachments` manifest. XCTest names a
 * user attachment `<name>_<index>_<uuid>.<ext>`, so `tunes.timeline.json` exports as
 * `tunes.timeline_0_<uuid>.json` and `tunes.png` as `tunes_0_<uuid>.png`. A capture with a still
 * is a still; any other is a clip and needs the test's screen recording and its start time.
 * Throws naming every capture that is missing something, so a partial run changes nothing.
 */
export function findAttachments(manifestJson: unknown, names: string[]): Map<string, Found> {
  if (!Array.isArray(manifestJson)) throw new Error('the attachments manifest is not a list')
  const tests = manifestJson as Test[]
  const found = new Map<string, Found>()
  const missing: string[] = []

  for (const name of names) {
    const timelineName = new RegExp(`^${escape(name)}\\.timeline_\\d+_[0-9A-F-]+\\.json$`, 'i')
    const stillName = new RegExp(`^${escape(name)}_\\d+_[0-9A-F-]+\\.png$`, 'i')
    const test = tests.find((t) =>
      t.attachments?.some((a) => timelineName.test(a.suggestedHumanReadableName)),
    )
    if (!test) {
      missing.push(`${name} (no timeline)`)
      continue
    }
    const by = (pattern: RegExp) =>
      test.attachments.find((a) => pattern.test(a.suggestedHumanReadableName))
    const timeline = by(timelineName)!.exportedFileName
    const still = by(stillName)
    if (still) {
      found.set(name, { timeline, still: still.exportedFileName })
      continue
    }
    const video = test.attachments.find((a) => a.exportedFileName.endsWith('.mp4'))
    if (!video || typeof video.timestamp !== 'number') {
      missing.push(`${name} (no screen recording)`)
      continue
    }
    found.set(name, { timeline, video: video.exportedFileName, recordingStart: video.timestamp })
  }

  if (missing.length > 0) throw new Error(`captures missing attachments: ${missing.join(', ')}`)
  return found
}
