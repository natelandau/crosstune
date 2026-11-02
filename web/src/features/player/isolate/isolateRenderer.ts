import { IsolateMask } from './isolateMask'
import type { IsolateMessage, IsolateOutline } from './isolateMessages'
import { isIsolateOff } from './isolateSetting'

const CROSSFADE_S = 0.05
const OUTLINES_PER_S = 15

/**
 * The isolate processor's audio work, kept apart from `AudioWorkletProcessor` so it runs under
 * test. Mixes the mask's output over the dry input. Engaging feeds the mask while the output
 * stays dry until the mask's latency has passed, then crossfades over 50 ms; bypassing
 * crossfades back. The dry side is not delayed to match the mask's latency.
 */
export class IsolateRenderer {
  private readonly mask: IsolateMask
  private readonly mixStep: number
  private readonly framesPerOutline: number
  private engaged = false
  private isDefault = true
  /** How much of the output is the mask's, 0 to 1. */
  private mix = 0
  /** Frames fed to the mask since engaging from bypass. The output stays dry until they pass
   * its latency, so the crossfade never fades toward silence. */
  private primedFrames = 0
  private framesSinceOutline = 0
  /** Consecutive all-zero input frames, counted up to `drainFrames`. */
  private silentFrames = 0
  private readonly drainFrames: number
  private wetLeft = new Float32Array(128)
  private wetRight = new Float32Array(128)

  constructor(
    sampleRate: number,
    private readonly postOutline: (outline: IsolateOutline) => void,
  ) {
    this.mask = new IsolateMask(sampleRate)
    this.mixStep = 1 / (CROSSFADE_S * sampleRate)
    this.framesPerOutline = sampleRate / OUTLINES_PER_S
    // The last nonzero input frame reaches the mask's last analysis frame within one
    // latency, and that frame's output finishes playing within another.
    this.drainFrames = 2 * this.mask.latencyFrames
  }

  receive(message: IsolateMessage): void {
    if ('setting' in message) {
      this.mask.setSetting(message.setting, message.isMono)
      this.isDefault = isIsolateOff(message.setting, message.isMono)
    } else if ('engaged' in message) {
      // The mask measured no outline while disengaged, so the first one waits a full interval.
      if (message.engaged && !this.engaged) this.framesSinceOutline = 0
      this.engaged = message.engaged
    } else {
      this.resetMask()
    }
  }

  /** Mid-fade, the cleared mask would leave the fade between dry and silence, so a reset drops
   * to dry: bypassing ends there, and engaging primes again. */
  private resetMask(): void {
    this.mask.reset()
    if (this.mix < 1) {
      this.mix = 0
      this.primedFrames = 0
    }
  }

  /** One render quantum: `inputs` and `outputs` are the channels of the node's only input and
   * output. A mono input reaches every output channel. */
  render(inputs: Float32Array[], outputs: Float32Array[]): void {
    const left = inputs[0]
    if (!left) {
      for (const channel of outputs) channel.fill(0)
      return
    }
    const right = inputs[1] ?? left
    const frames = left.length
    const target = this.engaged || !this.isDefault ? 1 : 0

    if (this.mix === 0 && target === 0) {
      passDry(left, right, outputs)
      this.silentFrames = 0
      this.primedFrames = 0
      return
    }

    const silent = isSilent(left) && (right === left || isSilent(right))
    const wasDrained = this.silentFrames >= this.drainFrames
    this.silentFrames = silent ? Math.min(this.drainFrames, this.silentFrames + frames) : 0
    if (this.silentFrames >= this.drainFrames) {
      // A paused element still sends silent blocks. Once the mask's tail has played out it
      // holds nothing but zeros, so it can rest, and the last outline stays on screen.
      if (!wasDrained) this.resetMask()
      for (const channel of outputs) channel.fill(0)
      // An engage waits for sound to prime the mask.
      if (this.mix > 0) this.mix = this.moveMix(this.mix, target, frames)
      if (this.mix === 0) this.framesSinceOutline = 0
      return
    }

    if (this.wetLeft.length !== frames) {
      this.wetLeft = new Float32Array(frames)
      this.wetRight = new Float32Array(frames)
    }
    const wetLeft = this.wetLeft
    wetLeft.set(left)
    let wetRight = wetLeft
    if (right !== left) {
      wetRight = this.wetRight
      wetRight.set(right)
    }
    if (this.mix === 0 && this.primedFrames === 0) this.mask.reset()
    // Engaged means something shows the outline; otherwise the mask skips measuring it.
    this.mask.process(wetLeft, wetRight, this.engaged)

    let priming = false
    if (this.mix === 0) {
      priming = this.primedFrames < this.mask.latencyFrames
      this.primedFrames += frames
    }
    if (priming) {
      passDry(left, right, outputs)
    } else {
      this.crossfade(left, right, wetLeft, wetRight, outputs, target)
      if (this.mix === 0) {
        this.framesSinceOutline = 0
        return
      }
    }

    if (silent || !this.engaged) return
    this.framesSinceOutline += frames
    if (this.framesSinceOutline >= this.framesPerOutline) {
      this.framesSinceOutline = 0
      const { pan, freq } = this.mask.outline()
      this.postOutline({ pan: pan.slice(), freq: freq.slice() })
    }
  }

  private crossfade(
    left: Float32Array,
    right: Float32Array,
    wetLeft: Float32Array,
    wetRight: Float32Array,
    outputs: Float32Array[],
    target: number,
  ): void {
    const outLeft = outputs[0]
    const outRight = outputs[1]
    let mix = this.mix
    if (mix === 1 && target === 1) {
      outLeft?.set(wetLeft)
      outRight?.set(wetRight)
    } else {
      for (let i = 0; i < left.length; i++) {
        mix = this.moveMix(mix, target, 1)
        // Equal power, since the wet path lags the dry by the mask's latency and the two add
        // as unrelated signals rather than in phase.
        const angle = (mix * Math.PI) / 2
        const dryGain = Math.cos(angle)
        const wetGain = Math.sin(angle)
        if (outLeft) outLeft[i] = left[i]! * dryGain + wetLeft[i]! * wetGain
        if (outRight) outRight[i] = right[i]! * dryGain + wetRight[i]! * wetGain
      }
    }
    for (let c = 2; c < outputs.length; c++) outputs[c]!.set(outLeft!)
    this.mix = mix
  }

  private moveMix(mix: number, target: number, frames: number): number {
    const step = this.mixStep * frames
    return target > mix ? Math.min(target, mix + step) : Math.max(target, mix - step)
  }
}

function passDry(left: Float32Array, right: Float32Array, outputs: Float32Array[]): void {
  for (let c = 0; c < outputs.length; c++) outputs[c]!.set(c === 0 ? left : right)
}

function isSilent(channel: Float32Array): boolean {
  for (let i = 0; i < channel.length; i++) if (channel[i] !== 0) return false
  return true
}
