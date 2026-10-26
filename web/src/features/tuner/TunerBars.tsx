import { blend } from './blend'
import { inTuneFraction, tuneStep, ZONE_CENTS } from './pitch/notes'

/** The furthest a bar travels, in cents and as a share of the stage's height. */
const FULL_CENTS = 50
const FULL_TRAVEL = 0.4
/** The target zone's height as a share of the stage's: its cents either way, on the bars' scale. */
const ZONE_HEIGHT = ((2 * ZONE_CENTS) / FULL_CENTS) * FULL_TRAVEL

/** The bars' color for a note `cents` off: stepped outside the target zone, blended inside it. */
function barColor(cents: number): string {
  const step = tuneStep(cents)
  if (step === 'far') return 'var(--coral)'
  return blend('--tune-close', '--known-dark', step === 'zone' ? inTuneFraction(cents) : 0)
}

/**
 * A slab at each side edge, level with the note when in tune, risen when sharp and sunk when
 * flat, over a target zone that spans the in-zone cents. Coral far off, light coral just outside
 * the zone, and turning green inside it as the note nears in tune.
 */
export function TunerBars({ cents }: { cents: number }) {
  const clamped = Math.max(-FULL_CENTS, Math.min(FULL_CENTS, cents))
  // `translate` percentages are of the track's own height, which is the stage's.
  const shift = (-clamped / FULL_CENTS) * FULL_TRAVEL * 100
  const inTune = inTuneFraction(cents)
  const color = barColor(cents)
  const zone = `color-mix(in srgb, ${blend('--silver', '--known-dark', inTune / 2)} ${14 + 6 * inTune}%, transparent)`
  return (
    <>
      {(
        [
          ['start-0', 'rounded-e-xl', 'rounded-e-md'],
          ['end-0', 'rounded-s-xl', 'rounded-s-md'],
        ] as const
      ).map(([side, zoneCorners, barCorners]) => (
        // Narrower than a fifth on a narrow stage, so a slab never reaches the note, and capped on
        // a wide one.
        <div
          key={side}
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 w-[min(20%,calc(50%_-_6rem),10rem)] ${side}`}
        >
          <div
            data-tuner-zone
            className={`absolute inset-x-0 ${zoneCorners} transition-[background-color] duration-(--dur-short) ease-(--ease)`}
            style={{
              top: `${50 - ZONE_HEIGHT * 50}%`,
              height: `${ZONE_HEIGHT * 100}%`,
              backgroundColor: zone,
            }}
          />
          <div
            data-tuner-track
            className="absolute inset-0 transition-[translate] duration-(--dur-short) ease-(--ease)"
            style={{ translate: `0 ${shift}%` }}
          >
            <div
              data-tuner-bar
              className={`absolute inset-x-0 top-1/2 h-[max(4%,0.5rem)] -translate-y-1/2 ${barCorners} transition-[background-color,box-shadow] duration-(--dur-short) ease-(--ease)`}
              style={{
                backgroundColor: color,
                boxShadow: `0 0 0.75rem color-mix(in srgb, ${color} 70%, transparent)`,
              }}
            />
          </div>
        </div>
      ))}
    </>
  )
}
