import { ToggleButton } from 'react-aria-components'
import { RECORDING_RANGES } from '../../api/vocabulary'
import {
  DEFAULT_ISOLATE,
  isIsolateOff,
  type IsolateEffect,
  type IsolateSetting,
} from '../player/isolate/isolateSetting'
import type { OutlineFeed } from './isolateOutlineFeed'
import { IsolateRange } from './IsolateRange'
import { SegmentedChoice } from '../../ui/SegmentedChoice'
import { SEGMENT } from '../../ui/segmentedTrack'
import { frequencyReadout, hzReadout, stereoEdgeReadout, stereoReadout } from './isolateReadout'
import { offWhen, PANEL_TEXT_BUTTON, RESET } from './panel'
import {
  FREQUENCY,
  FREQUENCY_HIGH,
  FREQUENCY_LOW,
  ISOLATE_EFFECT_LABEL,
  ISOLATE_PAUSES_ON_LOCK,
  ISOLATE_UNAVAILABLE,
  MONO_NOTICE,
  MUTE,
  SOLO,
  STEREO,
  STEREO_END,
  STEREO_START,
} from './practiceCopy'

const EFFECTS: readonly { id: IsolateEffect; label: string }[] = [
  { id: 'solo', label: SOLO },
  { id: 'mute', label: MUTE },
]

const EFFECT_IDS = EFFECTS.map((effect) => effect.id)

/** The full range each control spans, from the start field's lowest to the end field's
 * highest. */
const STEREO_RANGE = {
  min: RECORDING_RANGES.isolate_pan_start.min,
  max: RECORDING_RANGES.isolate_pan_end.max,
}
const FREQUENCY_RANGE = {
  min: RECORDING_RANGES.isolate_low_hz.min,
  max: RECORDING_RANGES.isolate_high_hz.max,
}

const STEREO_STEP = 5
const STEREO_LARGE_STEP = 20
const STEREO_MIN_SPAN = 10
/** Frequency steps, in octaves: a semitone, an octave, and a third of an octave. */
const FREQUENCY_STEP = 1 / 12
const FREQUENCY_LARGE_STEP = 1
const FREQUENCY_MIN_SPAN = 1 / 3

/**
 * Solo or mute of a stereo range and a frequency range of the recording. A mono recording
 * shows only the frequency range, since its stereo picture has nothing to pick from.
 */
export function IsolatePanel({
  value,
  isMono,
  unavailable,
  lockNotice,
  outline,
  onChange,
}: {
  value: IsolateSetting
  isMono: boolean
  /** The engine could not build its audio stage, so nothing here would be heard. */
  unavailable: boolean
  /** Says that isolated playback pauses when the screen locks, as it does on iOS. */
  lockNotice: boolean
  /** The engine's latest outline, drawn behind each range. */
  outline: OutlineFeed | null
  onChange: (setting: IsolateSetting) => void
}) {
  return (
    <div>
      {/* Mounted while empty, so the line is announced as it fills. Empty, it has no height. */}
      <p role="status" className="t-secondary m-0">
        {unavailable ? ISOLATE_UNAVAILABLE : null}
      </p>
      {/* One line in place of every control, since none of them would be heard. */}
      {unavailable ? null : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <SegmentedChoice
              label={ISOLATE_EFFECT_LABEL}
              options={EFFECT_IDS}
              selected={value.effect}
              onChange={(effect) => onChange({ ...value, effect })}
            >
              {EFFECTS.map((effect) => (
                <ToggleButton
                  key={effect.id}
                  id={effect.id}
                  className={`t-body ${SEGMENT} min-h-(--target) cursor-default rounded-(--radius-capsule) px-4 transition-colors duration-(--dur-short) ease-(--ease)`}
                >
                  {effect.label}
                </ToggleButton>
              ))}
            </SegmentedChoice>
            <button
              type="button"
              className={PANEL_TEXT_BUTTON}
              {...offWhen(isIsolateOff(value, isMono), () => onChange(DEFAULT_ISOLATE))}
            >
              {RESET}
            </button>
          </div>
          {isMono ? (
            <p className="t-secondary m-0">{MONO_NOTICE}</p>
          ) : (
            <IsolateRange
              label={STEREO}
              startLabel={STEREO_START}
              endLabel={STEREO_END}
              min={STEREO_RANGE.min}
              max={STEREO_RANGE.max}
              scale="linear"
              start={value.panStart}
              end={value.panEnd}
              minSpan={STEREO_MIN_SPAN}
              step={STEREO_STEP}
              largeStep={STEREO_LARGE_STEP}
              readout={stereoReadout}
              valueText={stereoEdgeReadout}
              outline={outline?.pan ?? null}
              onChange={(panStart, panEnd) => onChange({ ...value, panStart, panEnd })}
            />
          )}
          <IsolateRange
            label={FREQUENCY}
            startLabel={FREQUENCY_LOW}
            endLabel={FREQUENCY_HIGH}
            min={FREQUENCY_RANGE.min}
            max={FREQUENCY_RANGE.max}
            scale="log"
            start={value.lowHz}
            end={value.highHz}
            minSpan={FREQUENCY_MIN_SPAN}
            step={FREQUENCY_STEP}
            largeStep={FREQUENCY_LARGE_STEP}
            readout={frequencyReadout}
            valueText={hzReadout}
            outline={outline?.freq ?? null}
            onChange={(lowHz, highHz) => onChange({ ...value, lowHz, highHz })}
          />
          {lockNotice ? <p className="t-secondary m-0">{ISOLATE_PAUSES_ON_LOCK}</p> : null}
        </div>
      )}
    </div>
  )
}
