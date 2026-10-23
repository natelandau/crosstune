import CrosstuneAnalytics
import SwiftUI

/// The control that opens a screen's filter sheet. It
/// shows and says the count of set sheet filters, since filters persist and a stale one must
/// announce itself.
struct FiltersButton: View {
    nonisolated static let filters = "Filters"
    static let systemImage = "line.3.horizontal.decrease"

    /// The spoken name, with the count once one is set: "Filters, 2 set".
    nonisolated static func name(setCount: Int) -> String {
        setCount > 0 ? "\(filters), \(setCount) set" : filters
    }

    let setCount: Int
    /// Leaves the count to the filled glyph and the spoken name, for a bar whose glass group
    /// must not widen as filters are set.
    var iconOnly = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: Self.systemImage)
                    #if os(iOS)
                        .symbolVariant(setCount > 0 ? .circle.fill : .circle)
                    #else
                        // The search field's chip is the Mac's set state, so the glyph stays bare.
                        .fontWeight(.medium)
                    #endif
                if setCount > 0, !iconOnly {
                    Text(setCount, format: .number)
                        .monospacedDigit()
                        .contentTransition(
                            PhoneMotion.resolve(reduceMotion: reduceMotion).countTransition(value: Double(setCount)))
                }
            }
        }
        .phoneAnimation(value: setCount)
        .accessibilityLabel(Self.name(setCount: setCount))
        .help(Self.name(setCount: setCount))
    }
}
