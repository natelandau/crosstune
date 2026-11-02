import type { IsolateSetting } from './isolateSetting'

/** The name the isolate processor registers under in the audio worklet. */
export const ISOLATE_PROCESSOR = 'crosstune-isolate'

/** Input magnitude by pan and by log frequency, each scaled to 0..1. */
export type IsolateOutline = { pan: Float32Array; freq: Float32Array }

/** What the main thread posts to the processor. */
export type IsolateMessage =
  { setting: IsolateSetting; isMono: boolean } | { engaged: boolean } | { reset: true }

/** What the processor posts back. */
export type IsolateReport = { outline: IsolateOutline }
