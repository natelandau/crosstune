import CrosstuneStore

/// The point place search ranks its results near. It ranks and never filters, so a place far
/// from it is still found.
enum SearchHint {
    /// The first of the recording's own point, the device's position, the point of the
    /// musician's latest recording with a place, and the account country's center. Nil with none,
    /// which leaves the search worldwide. `device` is nil while location access is off.
    static func pick(
        recording: Coordinate?, device: Coordinate?, latestPlaced: Coordinate?, countryCenter: Coordinate?
    ) -> Coordinate? {
        recording ?? device ?? latestPlaced ?? countryCenter
    }
}

/// Where the pin map opens.
enum PinStart {
    /// The first of the recording's own point, the device's position, the area of the typed
    /// search, the point of the musician's latest recording with a place, and the account
    /// country's center. Nil with none, which opens on the whole world. `device` is nil while
    /// location access is off.
    static func pick(
        recording: Coordinate?, device: Coordinate?, searchArea: Coordinate?, latestPlaced: Coordinate?,
        countryCenter: Coordinate?
    ) -> Coordinate? {
        recording ?? device ?? searchArea ?? latestPlaced ?? countryCenter
    }
}
