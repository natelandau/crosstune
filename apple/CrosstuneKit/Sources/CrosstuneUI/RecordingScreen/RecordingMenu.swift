import CrosstuneCommands
import CrosstuneStore
import Foundation

/// An action in the recording page's ⋯ menu, which holds every action on the recording.
enum RecordingMenuItem: Hashable {
    /// Plays the recording first in lists of its tune, or stops that while `pinned`.
    case pin(pinned: Bool)
    case goToTune
    /// Opens the trim editor; `disabledReason` says why it cannot open now, and the item stays in the
    /// menu, disabled, showing it.
    case trim(disabledReason: String?)
    /// Opens the Split screen, disabled with the reason it cannot open now, as Trim is. It also
    /// splits a recording too large to upload whole.
    case split(disabledReason: String?)
    /// Opens an imported recording's page on the site it came from.
    case openOrigin(site: String, page: URL)
    /// Hands the recording's file to the system share sheet or share picker, disabled with the
    /// reason it cannot be exported now.
    case share(disabledReason: String?)
    /// Saves the recording's file through a save panel, on the Mac, disabled as Share is.
    case export(disabledReason: String?)
    /// Deletes the recording; disabled with `disabledReason` while it cannot go.
    case delete(disabledReason: String?)

    /// The menu in order: the pin while `pinned` is set, Go to tune when `goesToTune`, Open on
    /// when the recording has a page to open, Trim, Split, Share, Export… on the Mac, then
    /// Delete. `pinned` nil leaves the pin out, for a recording with no tune. `trims` false leaves
    /// Trim and Split out, as on a free plan; Share and Export… stay on every plan.
    static func items(
        pinned: Bool?, goesToTune: Bool, trimDisabledReason: String?, splitDisabledReason: String? = nil,
        deleteDisabledReason: String? = nil, exportDisabledReason: String?, openOrigin: RecordingMenuItem? = nil,
        trims: Bool = true
    ) -> [RecordingMenuItem] {
        let pin: [RecordingMenuItem] = pinned.map { [.pin(pinned: $0)] } ?? []
        let tools: [RecordingMenuItem] =
            trims ? [.trim(disabledReason: trimDisabledReason), .split(disabledReason: splitDisabledReason)] : []
        #if os(macOS)
            let exports: [RecordingMenuItem] = [
                .share(disabledReason: exportDisabledReason), .export(disabledReason: exportDisabledReason),
            ]
        #else
            let exports: [RecordingMenuItem] = [.share(disabledReason: exportDisabledReason)]
        #endif
        return pin + (goesToTune ? [.goToTune] : []) + (openOrigin.map { [$0] } ?? []) + tools + exports
            + [.delete(disabledReason: deleteDisabledReason)]
    }

    /// What the pin item writes as its tune's play source: nothing while `pinned`, which unpins,
    /// and otherwise recording `recordingID`.
    static func playSource(togglingPinned pinned: Bool, recordingID: String) -> PlaySourcePin? {
        pinned ? nil : .recording(id: recordingID)
    }

    /// The Open on item for `recording`, or nil for one made here or one with no web page.
    static func openOrigin(for recording: Recording) -> RecordingMenuItem? {
        MediaRow.SourceLine(recording: recording).map { .openOrigin(site: $0.title, page: $0.url) }
    }

    var isDelete: Bool {
        if case .delete = self { true } else { false }
    }

    /// Why the item cannot be used now, shown under its label; nil when it can.
    var disabledReason: String? {
        switch self {
        case .trim(let disabledReason), .split(let disabledReason), .share(let disabledReason),
            .export(let disabledReason), .delete(let disabledReason):
            disabledReason
        case .pin, .goToTune, .openOrigin: nil
        }
    }

    var label: String {
        switch self {
        case .pin(let pinned): pinned ? PlaySourceText.dontPlayFirst : PlaySourceText.playFirstInLists
        case .goToTune: RecordingsListText.goToTune
        case .trim: RecordingScreenText.trim
        case .split: RecordingScreenText.split
        case .openOrigin(let site, _): RecordingRowActions.openOn(site)
        case .share: RecordingExportText.share
        case .export: RecordingExportText.export
        case .delete: RecordingRowActions.delete
        }
    }

    var systemImage: String {
        switch self {
        case .pin(let pinned): pinned ? "pin.slash" : "pin.fill"
        case .goToTune: "arrow.right.circle"
        case .trim: "scissors"
        case .split: "rectangle.split.3x1"
        case .openOrigin: "arrow.up.right.square"
        case .share: "square.and.arrow.up"
        case .export: "square.and.arrow.down"
        case .delete: "trash"
        }
    }
}
