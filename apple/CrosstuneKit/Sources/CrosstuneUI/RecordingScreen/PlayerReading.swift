import Foundation

/// One reading of the player, which the trim and split screens watch.
struct PlayerReading: Equatable {
    let playing: Bool
    let elapsed: TimeInterval
}
