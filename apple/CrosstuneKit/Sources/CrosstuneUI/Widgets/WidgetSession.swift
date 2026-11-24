import CrosstuneStore
import CrosstuneWidgetIntents

/// The app's side of the widgets as users sign in and out: keeps the open store's summary
/// current, drops a widget request left for another account, and clears what a leaving user's
/// widgets kept.
@MainActor
public final class WidgetSession {
    private let publisher: WidgetPublisher?
    private let pageStore: ListWidgetPageStore?
    private let inbox: WidgetRequestInbox

    /// - Parameters:
    ///   - publisher: Nil in a build without the App Group, which has no widgets to keep current.
    ///   - pageStore: Nil in a build without the App Group.
    init(publisher: WidgetPublisher?, pageStore: ListWidgetPageStore?, inbox: WidgetRequestInbox) {
        self.publisher = publisher
        self.pageStore = pageStore
        self.inbox = inbox
    }

    #if os(iOS)
        /// The widgets of the App Group, of which a build without the entitlement keeps none.
        public static func appGroup() -> WidgetSession {
            WidgetSession(publisher: .appGroup(), pageStore: .appGroup(), inbox: .shared)
        }
    #endif

    /// The control to register for widget and Live Activity buttons, which clears what this
    /// session's summary shows of a list playback or recording the app no longer holds.
    public func controls(listPlayback: ListPlayback, recorders: RecorderHost) -> WidgetControls {
        WidgetControls(listPlayback: listPlayback, recorders: recorders, publisher: publisher)
    }

    /// Call it each time the open store changes, once `shareHost` follows `store`, which runs the
    /// summary's writes so a removal of the user's folder waits for them.
    public func storeChanged(
        from oldUserID: String?, to store: CrosstuneStore?, shareHost: ShareHost, recorders: RecorderHost,
        listPlayback: ListPlayback?, plan: PlanModel?
    ) {
        inbox.userChanged(from: oldUserID, to: store?.userID)
        guard let store, let publisher else { return }
        shareHost.publish(alongside: {
            await publisher.run(store: store, recorders: recorders, listPlayback: listPlayback, plan: plan)
        })
    }

    /// Call it when the musician signs out or deletes the account. The lists are theirs, so no
    /// later account reads their pages.
    public func userLeft() {
        pageStore?.removeAllPages()
    }
}
