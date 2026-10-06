import { describe, expect, it } from 'vitest'
import { findAttachments } from '../../capture/xcresult.ts'

const attachment = (exported: string, suggested: string, timestamp = 1791170915.072) => ({
  configurationName: 'Dark',
  deviceId: '045DB4D3-880C-4779-8640-F2466C4AB66B',
  deviceName: 'Crosstune Capture iPhone 17 Pro',
  exportedFileName: exported,
  isAssociatedWithFailure: false,
  suggestedHumanReadableName: suggested,
  timestamp,
})

// The shape `xcrun xcresulttool export attachments` writes, copied from a real run.
const manifest = [
  {
    attachments: [
      attachment('T1.json', 'tunes.timeline_0_21A2E4D9-7224-4266-B64B-BD7C737ADF45.json'),
      attachment('V1.mp4', 'Screen Recording 2026-10-04 at 11.28.35 PM.mp4', 1791170915.072),
      attachment('S1', 'Synthesized Event 2026-10-04 at 11.28.36 PM'),
    ],
    testIdentifier: 'FeatureCaptures/test_tunes()',
    testIdentifierURL:
      'test://com.apple.xcode/Crosstune/CrosstuneMarketingUITests/FeatureCaptures/test_tunes',
  },
  {
    attachments: [
      attachment('T2.json', 'tune.timeline_0_31A2E4D9-7224-4266-B64B-BD7C737ADF45.json'),
      attachment('V2.mp4', 'Screen Recording 2026-10-04 at 11.29.35 PM.mp4', 1791170975.5),
    ],
    testIdentifier: 'FeatureCaptures/test_tune()',
  },
  {
    attachments: [
      attachment('T3.json', 'lists.timeline_0_41A2E4D9-7224-4266-B64B-BD7C737ADF45.json'),
    ],
    testIdentifier: 'FeatureCaptures/test_lists()',
  },
  {
    attachments: [
      attachment('T4.json', 'family-iphone.timeline_0_51A2E4D9-7224-4266-B64B-BD7C737ADF45.json'),
      attachment('P4.png', 'family-iphone_0_DF607496-0580-40AA-BC26-62F7E3B64A85.png'),
    ],
    testIdentifier: 'FamilyCaptures/test_family_iphone()',
  },
]

describe('findAttachments', () => {
  it("finds a clip's timeline, recording, and recording start", () => {
    expect(findAttachments(manifest, ['tunes']).get('tunes')).toEqual({
      timeline: 'T1.json',
      video: 'V1.mp4',
      recordingStart: 1791170915.072,
    })
  })

  it('tells tune from tunes', () => {
    expect(findAttachments(manifest, ['tune']).get('tune')?.video).toBe('V2.mp4')
  })

  it("finds a still's image", () => {
    expect(findAttachments(manifest, ['family-iphone']).get('family-iphone')).toMatchObject({
      timeline: 'T4.json',
      still: 'P4.png',
    })
  })

  it('names a clip with no recording', () => {
    expect(() => findAttachments(manifest, ['tunes', 'lists'])).toThrow(/lists/)
  })

  it('names every capture with no timeline', () => {
    expect(() => findAttachments(manifest, ['tunes', 'folk', 'record'])).toThrow(
      /folk.*record|record.*folk/,
    )
  })

  it('rejects a manifest that is not an export list', () => {
    expect(() => findAttachments({}, ['tunes'])).toThrow()
  })
})
