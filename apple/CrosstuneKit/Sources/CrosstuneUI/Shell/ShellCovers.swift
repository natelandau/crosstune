import SwiftUI

/// How many views are covering some part of the shell. It counts claims rather than holding a
/// flag, so one cover leaving never uncovers the shell under another arriving.
@MainActor
@Observable
final class ShellCover {
    private var claims = 0

    var isCovered: Bool { claims > 0 }

    func claim() {
        claims += 1
    }

    func release() {
        claims = max(0, claims - 1)
    }
}

extension EnvironmentValues {
    /// Covers the iPhone tab bar's record dome: a selecting screen's toolbar takes the bar's
    /// place, and a sheet's glass would show the red dome through it. Supplied by the shell;
    /// nil outside it.
    @Entry var domeCover: ShellCover?
    /// Counts the sheets, dialogs, and file pickers up over the shell, so a menu command that
    /// would open another stands down meanwhile. Supplied by the shell; nil outside it.
    @Entry var openSheets: ShellCover?
    /// Counts the screens that are selecting, whose toolbar replaces the commands that make
    /// things. Supplied by the shell; nil outside it.
    @Entry var selecting: ShellCover?
}

extension View {
    /// Marks this view as a sheet over the shell while it shows: the record dome hides and the
    /// menu commands that open sheets stand down.
    func shellSheet() -> some View {
        // The dome comes back as the sheet starts down rather than once it has gone, so the bar
        // is whole when the sheet clears it.
        modifier(Covers(cover: \.domeCover, isCovering: true, endsAsDismissed: true))
            .modifier(Covers(cover: \.openSheets, isCovering: true))
    }

    /// A ``shellSheet()`` that opens part way and drags to full height.
    func partHeightSheet() -> some View {
        presentationDetents([.medium, .large])
            .shellSheet()
    }

    /// Covers the shell while `isPresenting` is true and this view shows. Put it on the view that
    /// presents a dialog, alert, file picker, or share sheet, which have no root view of their own
    /// to mark.
    func coversShell(_ isPresenting: Bool) -> some View {
        modifier(Covers(cover: \.domeCover, isCovering: isPresenting))
            .modifier(Covers(cover: \.openSheets, isCovering: isPresenting))
    }

    /// Marks this screen as selecting while `isSelecting` is true: the record dome and record
    /// button give way to the selection's toolbar, and New tune stands down.
    func claimsSelection(_ isSelecting: Bool) -> some View {
        modifier(Covers(cover: \.domeCover, isCovering: isSelecting))
            .modifier(Covers(cover: \.selecting, isCovering: isSelecting))
    }
}

/// Whether a view holds its claim on a cover: only while it shows and wants to cover.
struct CoverClaim: Equatable {
    enum Change: Equatable {
        case claim
        case release
    }

    private(set) var isShown = false
    private(set) var isCovering: Bool
    private(set) var isClaimed = false

    init(isCovering: Bool) {
        self.isCovering = isCovering
    }

    /// The claim to make or give back after the view appears or disappears, or its wish to
    /// cover changes. Nil when nothing changes.
    mutating func update(isShown: Bool? = nil, isCovering: Bool? = nil) -> Change? {
        if let isShown { self.isShown = isShown }
        if let isCovering { self.isCovering = isCovering }
        let wanted = self.isShown && self.isCovering
        guard wanted != isClaimed else { return nil }
        isClaimed = wanted
        return wanted ? .claim : .release
    }
}

/// Holds one claim on a cover while `isCovering` is true and the view shows. With
/// `endsAsDismissed`, the claim ends as the presentation holding the view starts to leave,
/// where `onDisappear` comes only once it has gone.
private struct Covers: ViewModifier {
    private let isCovering: Bool
    private let endsAsDismissed: Bool

    @Environment private var cover: ShellCover?
    @State private var claim: CoverClaim
    @State private var isLeaving = false

    init(cover: KeyPath<EnvironmentValues, ShellCover?>, isCovering: Bool, endsAsDismissed: Bool = false) {
        _cover = Environment(cover)
        _claim = State(initialValue: CoverClaim(isCovering: isCovering))
        self.isCovering = isCovering
        self.endsAsDismissed = endsAsDismissed
    }

    private var wantsCover: Bool {
        isCovering && !isLeaving
    }

    func body(content: Content) -> some View {
        content
            #if os(iOS)
                .background {
                    if endsAsDismissed {
                        LeavingWatch { isLeaving = $0 }
                    }
                }
            #endif
            .onAppear { apply(claim.update(isShown: true, isCovering: wantsCover)) }
            .onDisappear { apply(claim.update(isShown: false)) }
            .onChange(of: wantsCover) { apply(claim.update(isCovering: wantsCover)) }
    }

    private func apply(_ change: CoverClaim.Change?) {
        switch change {
        case .claim: cover?.claim()
        case .release: cover?.release()
        case nil: break
        }
    }
}

#if os(iOS)
    /// Reports true as the view controller holding this view starts to disappear, as when its
    /// sheet starts down, and false as it starts to appear again, as when a swipe down is let go.
    private struct LeavingWatch: UIViewControllerRepresentable {
        let onChange: @MainActor (Bool) -> Void

        func makeUIViewController(context: Context) -> Controller {
            Controller(onChange: onChange)
        }

        func updateUIViewController(_ controller: Controller, context: Context) {
            controller.onChange = onChange
        }

        final class Controller: UIViewController {
            var onChange: @MainActor (Bool) -> Void

            init(onChange: @escaping @MainActor (Bool) -> Void) {
                self.onChange = onChange
                super.init(nibName: nil, bundle: nil)
            }

            @available(*, unavailable)
            required init?(coder: NSCoder) {
                fatalError("init(coder:) is not supported")
            }

            override func viewWillAppear(_ animated: Bool) {
                super.viewWillAppear(animated)
                onChange(false)
            }

            override func viewWillDisappear(_ animated: Bool) {
                super.viewWillDisappear(animated)
                onChange(true)
            }
        }
    }
#endif

/// When each menu command can act, from what covers the shell.
enum MenuGates {
    /// New tune opens its form, unless a sheet or dialog is up, or a screen is selecting.
    static func newTune(sheetsOpen: Bool, selecting: Bool) -> Bool {
        !sheetsOpen && !selecting
    }

    /// New list opens its sheet, unless a sheet or dialog is up.
    static func newList(sheetsOpen: Bool) -> Bool {
        !sheetsOpen
    }

    /// Find focuses the search field of a screen on show, unless a sheet or dialog is up.
    static func find(isShown: Bool, sheetsOpen: Bool) -> Bool {
        isShown && !sheetsOpen
    }

    /// Sort By sorts the screen on show, unless a sheet or dialog is up or the screen is
    /// selecting.
    static func sort(isShown: Bool, sheetsOpen: Bool, selecting: Bool = false) -> Bool {
        isShown && !sheetsOpen && !selecting
    }

    /// Record opens its sheet, unless a sheet or dialog is up, a screen is selecting, a take is
    /// already asked for, or some window's take has the microphone.
    static func record(sheetsOpen: Bool, selecting: Bool, takePending: Bool, capturing: Bool) -> Bool {
        !sheetsOpen && !selecting && !takePending && !capturing
    }

    /// The player's commands and the destination commands act unless a sheet or dialog is up,
    /// which leaves the keys to it. The recording screen carries its own.
    static func controls(sheetsOpen: Bool) -> Bool {
        !sheetsOpen
    }
}
