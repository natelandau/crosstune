import Observation
import SwiftUI

/// The take saved last, so the row it landed on can light up once. The shell sets it as the
/// record sheet closes; the row whose recording matches clears it when its highlight ends.
@MainActor
@Observable
public final class RecentTake {
    /// How long a mark stays claimable: the highlight plus a grace for a row that appears late.
    static let lifetime: Duration = PhoneStyle.newTakeHighlight + .seconds(3.5)

    @ObservationIgnored private let now: () -> Date
    private var markedID: String?
    @ObservationIgnored private var markedAt = Date.distantPast

    /// The take to highlight, or nil once cleared or older than ``lifetime``, so a row that
    /// shows long after the save does not light up.
    public var id: String? {
        guard let markedID, now().timeIntervalSince(markedAt) <= Self.lifetime.seconds else { return nil }
        return markedID
    }

    public init(now: @escaping () -> Date = Date.init) {
        self.now = now
    }

    public func mark(_ id: String) {
        markedID = id
        markedAt = now()
    }

    public func clear() { markedID = nil }

    /// Clears the mark only while it is still `id`, so a row finishing late never wipes a newer take.
    func clear(ifID id: String) {
        if markedID == id { markedID = nil }
    }
}

/// How a highlight spends `PhoneStyle.newTakeHighlight`: a quarter fading in, half held, a
/// quarter fading out.
enum HighlightTiming {
    static let fadeIn: Duration = PhoneStyle.newTakeHighlight / 4
    static let hold: Duration = PhoneStyle.newTakeHighlight / 2
    static let fadeOut: Duration = PhoneStyle.newTakeHighlight / 4
}

/// One highlight's sequence: light up, hold, fade out, then clear the mark. Cut short, by a
/// newer take, an expired mark, or the row going away, it fades out from where it is rather
/// than snapping off, and leaves the mark alone.
@MainActor
struct HighlightRun {
    /// Lights the row up or down over a duration.
    let set: (Bool, Duration) -> Void
    /// Waits, throwing once the run is cancelled.
    let sleep: (Duration) async throws -> Void
    let clear: () -> Void

    func run() async {
        set(true, HighlightTiming.fadeIn)
        do {
            try await sleep(HighlightTiming.fadeIn + HighlightTiming.hold)
            set(false, HighlightTiming.fadeOut)
            try await sleep(HighlightTiming.fadeOut)
            clear()
        } catch {
            set(false, HighlightTiming.fadeOut)
        }
    }
}

/// Washes a recording's row in slate while it is the take just saved, then clears the mark.
private struct NewTakeHighlight: ViewModifier {
    let recordingID: String

    @Environment(RecentTake.self) private var recentTake: RecentTake?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    @State private var lit = false

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 10).fill(BrandStyle.setFill(scheme)).opacity(lit ? 1 : 0)
            )
            // Keyed on the id, so a take marked before the row appears still lights it.
            .task(id: recentTake?.id) {
                guard let recentTake, recentTake.id == recordingID else { return }
                await HighlightRun(
                    set: set, sleep: { try await Task.sleep(for: $0) },
                    clear: { recentTake.clear(ifID: recordingID) }
                ).run()
            }
    }

    private func set(_ on: Bool, _ duration: Duration) {
        if reduceMotion {
            lit = on
        } else {
            withAnimation(.easeInOut(duration: duration.seconds)) { lit = on }
        }
    }
}

extension Duration {
    var seconds: Double {
        Double(components.seconds) + Double(components.attoseconds) / 1e18
    }
}

extension View {
    /// Highlights the row for `recordingID` when it is the take just saved.
    func newTakeHighlight(_ recordingID: String) -> some View {
        modifier(NewTakeHighlight(recordingID: recordingID))
    }
}
