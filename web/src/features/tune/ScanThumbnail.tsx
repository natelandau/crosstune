import type { ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'
import { ImageOff } from 'lucide-react'
import { SCAN_UNREADABLE } from '../scans/scanCopy'
import { aspectRatio, useThumbnail } from '../scans/scanImages'
import { THUMBNAIL_HEIGHT } from '../scans/thumbnail'

/** A scan at a fixed height: its image, a broken-scan mark, or a blank of its size. */
export function ScanThumbnail({
  scan,
  file,
  height = THUMBNAIL_HEIGHT,
}: {
  scan: LocalScan
  file: ScanFile | undefined
  height?: number
}) {
  const thumbnail = useThumbnail(file, scan.height)
  const size = { height, width: height * aspectRatio(scan) }
  if (file && thumbnail.kind === 'ready') {
    return (
      <img src={thumbnail.url} alt="" className="ph-no-capture block object-contain" style={size} />
    )
  }
  return (
    <span className="bg-surface grid place-items-center" style={size}>
      {file && thumbnail.kind === 'broken' && (
        <>
          <ImageOff className="text-ink-2 size-6" aria-hidden />
          <span className="sr-only">{SCAN_UNREADABLE}</span>
        </>
      )}
    </span>
  )
}
