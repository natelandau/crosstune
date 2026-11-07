import { deviceRegion } from '../../../platform/deviceRegion'

export type DistanceUnits = 'imperial' | 'metric'

const M_PER_MILE = 1609.344
const FT_PER_M = 3.28084
/** The regions whose people read road distances in miles and feet. */
const IMPERIAL_REGIONS = new Set(['US', 'GB', 'LR', 'MM'])

/** The units the locale reads distances in: miles in the regions that use them, else meters. */
export function distanceUnits(locale: string): DistanceUnits {
  const region = deviceRegion(locale)
  return region && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric'
}

interface DistanceFormat {
  units: DistanceUnits
  whole: Intl.NumberFormat
  oneDecimal: Intl.NumberFormat
}

// Built once for each locale, since a number format is costly to make for every row.
const formats = new Map<string, DistanceFormat>()

function formatFor(locale: string): DistanceFormat {
  let format = formats.get(locale)
  if (!format) {
    let resolved: string
    try {
      resolved = Intl.NumberFormat.supportedLocalesOf(locale)[0] ?? 'en-US'
    } catch {
      resolved = 'en-US'
    }
    format = {
      units: distanceUnits(locale),
      whole: new Intl.NumberFormat(resolved, { maximumFractionDigits: 0 }),
      oneDecimal: new Intl.NumberFormat(resolved, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    }
    formats.set(locale, format)
  }
  return format
}

/** Rounded to the nearest 10, and never below 10, so a spot at hand never reads as 0. */
const tens = (value: number) => Math.max(10, Math.round(value / 10) * 10)

/**
 * A distance as a place row shows it, in the locale's units and numbers: feet under a tenth of a
 * mile, else miles with one decimal; in metric, meters under a kilometer, else kilometers with
 * one decimal. The locale defaults to the device's.
 */
export function formatDistance(meters: number, locale: string = navigator.language): string {
  const { units, whole, oneDecimal } = formatFor(locale)
  if (units === 'imperial') {
    const miles = meters / M_PER_MILE
    return miles < 0.1
      ? `${whole.format(tens(meters * FT_PER_M))} ft`
      : `${oneDecimal.format(miles)} mi`
  }
  const rounded = tens(meters)
  return rounded < 1000 ? `${whole.format(rounded)} m` : `${oneDecimal.format(meters / 1000)} km`
}
