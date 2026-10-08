import { formatPreciseDuration } from '../../text/format'
import type { ShownPeaks } from './recordingRange'
import { DETAIL_LABEL, LENGTH_LABEL, OVERVIEW_LABEL } from './trimViewCopy'
import { END_HANDLE, START_HANDLE, TrimStrip } from './TrimStrip'
import type { stripProps, TrimEditor } from './useTrimEditor'

/**
 * Trim's two strips: the overview of the whole current recording, whose handles
 * the keyboard and screen readers reach, over the zoomed detail around the handle last touched,
 * which pinches and ctrl-scrolls zoom.
 */
export function TrimStrips({
  trim,
  dispatch,
  playheadMs,
  loaded,
  detail,
  seek,
  detailBox,
  pinch,
  holdDetail,
  shown,
}: ReturnType<typeof stripProps> & {
  /** The peaks for the recording's current trim range. */
  shown: ShownPeaks | null
}) {
  return (
    <>
      <TrimStrip
        range={trim.bounds}
        trim={trim}
        dispatch={dispatch}
        shown={shown}
        playheadMs={playheadMs}
        loaded={loaded}
        label={OVERVIEW_LABEL}
        compact
        announced
        onSeek={seek}
      />
      <div ref={detailBox} data-trim-detail {...pinch}>
        <TrimStrip
          range={detail}
          trim={trim}
          dispatch={dispatch}
          shown={shown}
          playheadMs={playheadMs}
          loaded={loaded}
          label={DETAIL_LABEL}
          onSeek={seek}
          onDragChange={holdDetail}
        />
      </div>
    </>
  )
}

/**
 * Where each handle stands and how long the cut plays, counted from the current trim's start.
 * `typeClass` is the app's own small text style.
 */
export function TrimReadout({
  trim,
  low,
  typeClass,
}: Pick<TrimEditor, 'trim' | 'low'> & { typeClass: string }) {
  const cells = [
    [START_HANDLE, trim.start - low],
    [LENGTH_LABEL, trim.end - trim.start],
    [END_HANDLE, trim.end - low],
  ] as const
  return (
    <dl className={`${typeClass} grid flex-1 grid-cols-3 text-center tabular-nums`}>
      {cells.map(([term, ms]) => (
        <div key={term}>
          <dt className="text-(--panel-muted)">{term}</dt>
          <dd>{formatPreciseDuration(ms)}</dd>
        </div>
      ))}
    </dl>
  )
}
