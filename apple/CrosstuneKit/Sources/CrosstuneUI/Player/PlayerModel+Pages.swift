import Foundation

/// A recording page on show: the recording it is for, and the window it is in.
struct ShownPage: Equatable {
    let recordingID: String
    /// Nil where the app does not know the window, as in a preview.
    let window: UUID?
}

/// What of a recording page on show is on screen, and what the page does once none of it is.
struct PageSurfaces {
    var shown: Set<RecordingPageSurface>
    let onLeft: @MainActor () -> Void
}

/// The recording pages, whose own controls are the player while one shows the loaded recording.
/// Playback a play on a page started belongs to that page: no dock or player bar shows for it,
/// and it stops as the page leaves. Playback from elsewhere carries on past the page.
extension PlayerModel {
    /// Whether a recording page is the player for `window`, whose dock or player bar then gives
    /// way: the page that started the loaded recording, in whichever window, or any page in
    /// `window` that shows it.
    public func pagePlays(in window: UUID?) -> Bool {
        guard let item, item.kind == .recording else { return false }
        if owningPage != nil { return true }
        return shownPages.values.contains(ShownPage(recordingID: item.id, window: window))
    }

    /// `surface` of recording page `page` is on screen, showing `recordingID` in `window`.
    /// `onLeft` runs once the page has left.
    func pageShown(
        _ page: UUID, surface: RecordingPageSurface, recordingID: String, window: UUID?,
        onLeft: @escaping @MainActor () -> Void
    ) {
        pageSurfaces[page] = PageSurfaces(shown: (pageSurfaces[page]?.shown ?? []).union([surface]), onLeft: onLeft)
        let shown = ShownPage(recordingID: recordingID, window: window)
        guard shownPages[page] != shown else { return }
        shownPages[page] = shown
    }

    /// `surfaces` of recording page `page` have left the screen. A page with nothing left on
    /// screen leaves on the main actor's next turn, unless a surface of it shows again first:
    /// a push between the page and its editor, or a fold that swaps the shell and makes the page
    /// again, lands in one update. See ``pagesLeft()``.
    func pageHidden(_ page: UUID, surfaces: Set<RecordingPageSurface>) {
        guard var entry = pageSurfaces[page] else { return }
        entry.shown.subtract(surfaces)
        pageSurfaces[page] = entry
        guard entry.shown.isEmpty, pageLeaving == nil else { return }
        pageLeaving = Task { [weak self] in self?.pagesLeft() }
    }

    /// Takes every page with nothing on screen off show and runs its `onLeft`. Playback a page
    /// that left started stops, unless another page for the same recording now shows in the
    /// same window, which takes it over.
    private func pagesLeft() {
        pageLeaving = nil
        var left: [UUID: ShownPage] = [:]
        for (page, surfaces) in pageSurfaces where surfaces.shown.isEmpty {
            pageSurfaces[page] = nil
            left[page] = shownPages.removeValue(forKey: page)
            surfaces.onLeft()
        }
        guard let owner = owningPage, let from = left[owner] else { return }
        if let next = shownPages.first(where: { $0.value == from })?.key {
            owningPage = next
        } else {
            close()
        }
    }
}
