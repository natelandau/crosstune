import CoreGraphics

/// A horizontal swipe on the iPhone's now-playing accessory, which skips through the playing
/// list as a swipe on Apple Music's does.
enum AccessorySwipe {
    enum Skip: Equatable {
        case next
        case previous
    }

    /// The skip a swipe `translation` points wide asks for: leftward past `threshold` is next,
    /// rightward is previous, and anything shorter, or any swipe while no list plays, is none.
    static func skip(
        translation: CGFloat, threshold: CGFloat = PhoneStyle.swipeSkipThreshold, isPlayingList: Bool
    ) -> Skip? {
        guard isPlayingList, abs(translation) > threshold else { return nil }
        return translation < 0 ? .next : .previous
    }

    /// Whether the list has somewhere for `skip` to go from `position` of `count`: next past the
    /// last tune only while the list repeats, previous only after the first.
    static func hasPlace(for skip: Skip, position: Int, count: Int, repeats: Bool) -> Bool {
        switch skip {
        case .next: repeats || position < count
        case .previous: position > 1
        }
    }
}
