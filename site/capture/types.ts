/** One capture's scene markers and taps, in wall-clock seconds and screen points. */
export type Timeline = {
  name: string
  scale: number
  start: number
  end: number
  taps: Tap[]
}

export type Tap = { t: number; x: number; y: number }

/** A stretch of the source recording to keep, in seconds from the recording's start. */
export type Window = { ss: number; to: number }

export type Device = 'iphone' | 'ipad' | 'mac' | 'browser' | 'android'

export type CaptureEntry =
  | {
      kind: 'clip'
      video: string
      poster: string
      width: number
      height: number
      duration: number
      device: Device
    }
  | { kind: 'still'; image: string; width: number; height: number; device: Device }

export type Manifest = { captures: Record<string, CaptureEntry> }
