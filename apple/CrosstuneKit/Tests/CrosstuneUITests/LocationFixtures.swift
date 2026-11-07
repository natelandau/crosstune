import CrosstuneStore
import CrosstuneTestSupport

/// A recording for the location tests with whatever place a test gives it, its origin set as the
/// store would: picked for a point with no accuracy, else from the device.
func placedRecording(
    _ id: String = "r1", name: String? = nil, at point: Coordinate? = nil, placeID: String? = nil, minutes: Int64 = 0
) -> Recording {
    Recording(
        id: id, tuneID: nil, source: "microphone", addedAt: later(minutes * 60_000), state: "ready",
        placeName: name, placeLat: point?.lat, placeLon: point?.lon, placeAccuracyM: point?.accuracyM,
        placeID: placeID, placeOrigin: point == nil ? nil : point?.accuracyM == nil ? "picked" : "device")
}
