import SwiftUI

/// The split view's detail column while no tune is chosen.
public struct TuneDetailPlaceholder: View {
    public static let title = "No tune selected"

    public init() {}

    public var body: some View {
        ContentUnavailableView(Self.title, systemImage: "music.note")
    }
}
