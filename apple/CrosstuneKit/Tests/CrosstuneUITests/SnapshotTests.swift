import CrosstuneStore
import SwiftUI
import Testing

@testable import CrosstuneUI

/// Renders every shared component to PNG for review. See ``snapshot(_:width:_:)``.
@MainActor
@Suite struct SnapshotTests {
    private let keys = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"]

    @Test func keyPills() {
        snapshot("key-pills") {
            VStack(alignment: .leading, spacing: 12) {
                FlowLayout { ForEach(keys, id: \.self) { KeyPill($0) } }
                FlowLayout { ForEach(keys, id: \.self) { KeyPill($0, chosen: true) } }
                FlowLayout {
                    KeyPill("D", size: .compact)
                    KeyPill("E", suffix: " dor", size: .compact)
                    KeyPill("A", suffix: " mix", size: .compact)
                    KeyPill("G", suffix: " modal", size: .compact)
                    KeyPill("C/G", size: .compact)
                    KeyPill("C/G")
                    KeyPill("C/G", chosen: true)
                }
            }
        }
    }

    @Test func status() {
        snapshot("status") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 16) {
                    StatusDot("known")
                    StatusDot("learning")
                    StatusDot("want_to_learn")
                }
                .font(.subheadline)
                StatusRail(status: .constant("learning"))
                StatusRail(filter: .constant(nil))
                StatusRail(filter: .constant("want_to_learn"))
            }
        }
    }

    @Test func tuneRows() {
        snapshot("tune-rows") { tuneRows(instruments: SampleCatalog.instruments) }
    }

    @Test func listRows() {
        snapshot("list-rows") {
            rows(Array(SampleCatalog.entries.prefix(5).enumerated()), id: \.element.tune.id) { index, entry in
                TuneRow(tune: entry.tune, userTune: entry.userTune, instruments: ["violin"], position: index + 1)
            }
        }
    }

    @Test func mediaRows() {
        snapshot("media-rows") {
            rows(SampleCatalog.recordingRows.map(Row.recording) + SampleCatalog.linkRows.map(Row.link), id: \.self) {
                switch $0 {
                case .recording(let row): MediaRow(recording: row, perform: { _ in }, onRetry: { _ in })
                case .link(let row): MediaRow(link: row) { _ in }
                }
            }
        }
    }

    private enum Row: Hashable {
        case recording(RecordingRowContent)
        case link(LinkRowContent)
    }

    @Test func undoBanner() {
        snapshot("undo-banner") {
            VStack(spacing: 12) {
                UndoBanner(message: "Archived 3 tunes") {}
                UndoBanner(message: "Removed \"Soldier's Joy\" from Tuesday session") {}
            }
        }
    }

    @Test func facets() {
        snapshot("facets", width: 320) {
            FlowLayout {
                KeyPill("A", suffix: " mix")
                StatusDot("learning").font(.subheadline)
                Text("Reel")
                Text("Old-time")
                Text("4/4")
                Text("Violin: Cross A (AEAE)")
                Text("5-string banjo: Open A (aEAC#E)")
            }
            .font(.subheadline)
        }
    }

    private func tuneRows(instruments: Set<String>) -> some View {
        rows(SampleCatalog.entries, id: \.tune.id) { entry in
            TuneRow(tune: entry.tune, userTune: entry.userTune, instruments: instruments)
        }
    }

    /// Rows with separators, standing in for a `List`, which an image renderer cannot draw.
    private func rows<Item, ID: Hashable>(
        _ items: [Item], id: KeyPath<Item, ID>, @ViewBuilder row: @escaping (Item) -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items, id: id) { item in
                row(item)
                Divider()
            }
        }
    }
}
