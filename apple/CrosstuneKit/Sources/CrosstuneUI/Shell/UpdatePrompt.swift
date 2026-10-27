import CrosstuneAuth
import Foundation
import SwiftUI

extension EnvironmentValues {
    /// This app's App Store page, where an update is installed. Nil in a build with no App Store
    /// ID, whose update prompt offers no link.
    @Entry public var appStoreURL: URL?
}

/// The words of the prompt to update a build the API no longer supports.
public enum UpdatePromptText {
    public static let title = "Update Crosstune"
    public static let message =
        "This version can't sync anymore. Your changes are saved on this device and will sync after you update."
    public static let update = "Update"
    public static let notNow = "Not now"

    /// The App Store page for the app with Apple ID `id`, or nil without one. The Mac opens it in
    /// the App Store app, which a web link would leave to the browser.
    public static func appStoreURL(id: String?) -> URL? {
        guard let id, !id.isEmpty else { return nil }
        #if os(macOS)
            return URL(string: "macappstore://apps.apple.com/app/id\(id)")
        #else
            return URL(string: "https://apps.apple.com/app/id\(id)")
        #endif
    }
}

/// Which window shows the update prompt, shared by every window, so the prompt shows in one
/// active window at a time, and in the window the musician asked from.
@MainActor
@Observable
public final class UpdatePromptClaim {
    /// The window showing the prompt now, nil while none does.
    private(set) var holder: ObjectIdentifier?

    public init() {}

    /// Whether the window `owner` shows the prompt. It takes the claim while the prompt is due,
    /// the window is active, and no other window holds it; otherwise it lets the claim go.
    func shows(_ owner: ObjectIdentifier, due: Bool, isActive: Bool) -> Bool {
        guard due, isActive else {
            release(owner)
            return false
        }
        if holder == nil { holder = owner }
        return holder == owner
    }

    func release(_ owner: ObjectIdentifier) {
        if holder == owner { holder = nil }
    }

    /// Hands the claim to `owner`, the window the musician asked from, whichever window held it.
    func request(_ owner: ObjectIdentifier) {
        holder = owner
    }
}

extension EnvironmentValues {
    /// Shared by every window. The app sets it at the root of each scene; without one, a shell
    /// keeps its own.
    @Entry public var updatePromptClaim: UpdatePromptClaim?
    /// Shows the update prompt in this window. Nil outside a shell's ``View/updatePrompt(_:)``.
    @Entry var askForUpdate: AskForUpdate?
}

/// Shows the update prompt in the window that asks. Compared by what it acts on, so SwiftUI
/// does not invalidate every reader on each update as it would for a bare closure.
struct AskForUpdate: Equatable {
    fileprivate let session: AccountSession?
    fileprivate let claim: UpdatePromptClaim
    fileprivate let window: PromptWindow

    @MainActor func callAsFunction() {
        session?.showUpdatePrompt()
        claim.request(ObjectIdentifier(window))
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.session === rhs.session && lhs.claim === rhs.claim && lhs.window === rhs.window
    }
}

extension View {
    /// Asks the musician to update while `session` shows its update prompt; nothing without a
    /// session. Update opens the App Store page from the environment and is left out without one.
    func updatePrompt(_ session: AccountSession?) -> some View {
        modifier(UpdatePrompt(session: session))
    }
}

/// One window's place in an ``UpdatePromptClaim``.
private final class PromptWindow {}

private struct UpdatePrompt: ViewModifier {
    let session: AccountSession?

    @Environment(\.appStoreURL) private var appStoreURL
    #if os(iOS)
        @Environment(\.openURL) private var openURL
    #endif
    @Environment(\.scenePhase) private var scenePhase
    #if os(macOS)
        /// Every visible Mac window reads active, so only the key window counts as active here.
        @Environment(\.appearsActive) private var appearsActive
    #endif
    @Environment(\.updatePromptClaim) private var sharedClaim
    /// Used when the app shares no claim across windows, as in previews.
    @State private var ownClaim = UpdatePromptClaim()
    @State private var window = PromptWindow()
    @State private var shows = false

    private var claim: UpdatePromptClaim { sharedClaim ?? ownClaim }
    private var due: Bool { session?.showsUpdatePrompt ?? false }

    private var isPresented: Binding<Bool> {
        Binding(
            get: { shows },
            set: { presented in
                guard !presented else { return }
                shows = false
                session?.showsUpdatePrompt = false
            })
    }

    private var isActive: Bool {
        #if os(macOS)
            scenePhase == .active && appearsActive
        #else
            scenePhase == .active
        #endif
    }

    func body(content: Content) -> some View {
        content
            .environment(\.askForUpdate, AskForUpdate(session: session, claim: claim, window: window))
            #if os(macOS)
                .sheet(isPresented: isPresented) {
                    UpdatePromptSheet(appStoreURL: appStoreURL)
                }
            #else
                .coversShell(shows)
                .alert(UpdatePromptText.title, isPresented: isPresented) {
                    if let appStoreURL {
                        Button(UpdatePromptText.update) { openURL(appStoreURL) }
                    }
                    Button(UpdatePromptText.notNow, role: .cancel) {}
                } message: {
                    Text(UpdatePromptText.message)
                }
            #endif
            .onChange(of: due) { judge() }
            .onChange(of: isActive) { judge() }
            // A claim let go may be this window's turn.
            .onChange(of: claim.holder) { judge() }
            .onAppear { judge() }
            .onDisappear {
                claim.release(ObjectIdentifier(window))
                shows = false
            }
            #if DEBUG
                .opensForSample(.updatePrompt) { shows = true }
            #endif
    }

    private func judge() {
        shows = claim.shows(ObjectIdentifier(window), due: due, isActive: isActive)
    }
}

#if os(macOS)
    /// The update prompt as a Mac notice: the mark, the title, and why, with Update the primary
    /// and Not now beside it.
    struct UpdatePromptSheet: View {
        let appStoreURL: URL?

        @Environment(\.dismiss) private var dismiss
        @Environment(\.openURL) private var openURL

        /// Update as the default primary and Not now as Cancel, or Not now alone as the primary
        /// when there is no App Store page to update from.
        static func footer(
            canUpdate: Bool, update: @escaping @MainActor () -> Void, notNow: @escaping @MainActor () -> Void
        ) -> MacSheetFooter {
            guard canUpdate else {
                return MacSheetFooter(primary: .init(UpdatePromptText.notNow, action: notNow), escape: notNow)
            }
            let primary = MacSheetAction(UpdatePromptText.update) {
                update()
                notNow()
            }
            return MacSheetFooter(cancel: .cancel(UpdatePromptText.notNow, action: notNow), primary: primary)
        }

        var body: some View {
            let footer = Self.footer(
                canUpdate: appStoreURL != nil,
                update: { if let appStoreURL { openURL(appStoreURL) } },
                notNow: { dismiss() })
            MacSheet(
                title: UpdatePromptText.title, style: .notice, size: .fitted(.standard), cancel: footer.cancel,
                primary: footer.primary,
                escape: footer.escape
            ) {
                Text(UpdatePromptText.message)
                    .font(MacStyle.body)
                    .foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .shellSheet()
        }
    }
#endif
