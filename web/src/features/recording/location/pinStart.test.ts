import { expect, it } from 'vitest'
import { pinStart } from './pinStart'

const STORED = { lat: 40.67, lon: -73.96 }
const DEVICE = { lat: 36.66, lon: -80.92 }
const SEARCH_AREA = { lat: 40.68, lon: -74.0 }
const LATEST = { place_lat: 51.5, place_lon: -0.12 }
const COUNTRY = { lat: 39.5, lon: -98.5 }

it("starts at the recording's stored point first", () => {
  expect(
    pinStart({
      stored: STORED,
      device: DEVICE,
      searchArea: SEARCH_AREA,
      latestPlaced: LATEST,
      countryCenter: COUNTRY,
    }),
  ).toEqual({ lat: 40.67, lon: -73.96 })
})

it('starts at the device for a recording with no point', () => {
  expect(
    pinStart({
      stored: null,
      device: DEVICE,
      searchArea: SEARCH_AREA,
      latestPlaced: LATEST,
      countryCenter: COUNTRY,
    }),
  ).toEqual(DEVICE)
})

it('starts at the typed search area with no device', () => {
  expect(
    pinStart({
      stored: null,
      device: null,
      searchArea: SEARCH_AREA,
      latestPlaced: LATEST,
      countryCenter: COUNTRY,
    }),
  ).toEqual(SEARCH_AREA)
})

it('starts at the latest recording with a place with no search area', () => {
  expect(
    pinStart({
      stored: null,
      device: null,
      searchArea: null,
      latestPlaced: LATEST,
      countryCenter: COUNTRY,
    }),
  ).toEqual({ lat: 51.5, lon: -0.12 })
})

it("starts at the account country's center with no recording placed", () => {
  expect(
    pinStart({
      stored: null,
      device: null,
      searchArea: null,
      latestPlaced: null,
      countryCenter: COUNTRY,
    }),
  ).toEqual(COUNTRY)
})

it('leaves the world in view with none of them', () => {
  expect(
    pinStart({
      stored: null,
      device: null,
      searchArea: null,
      latestPlaced: null,
      countryCenter: null,
    }),
  ).toBeNull()
})
