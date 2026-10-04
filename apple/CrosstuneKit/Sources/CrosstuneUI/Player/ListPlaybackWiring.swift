import CrosstuneAudio
import CrosstuneAuth
import CrosstuneCommands
import CrosstuneStore
import SwiftUI

/// Points the app's playlist at this shell's store: each tune's source is read from the store
/// when its turn comes, within what this device can play, with the settings' play-first choice.
struct ListPlaybackWiring: ViewModifier {
    let store: CrosstuneStore
    let player: PlayerModel
    let playback: ListPlayback?

    @Environment(AccountSession.self) private var session: AccountSession?

    /// Stands in for Apple Music when the player has none, so no tune resolves to a song.
    private final class NoAppleMusic: AppleMusicAccess {
        func current() async -> AppleMusicAccessState { .declined }
        func request() async -> AppleMusicAccessState { .declined }
    }

    func body(content: Content) -> some View {
        content.task(id: ObjectIdentifier(store)) {
            let settings = settingsID(clerkUserID: store.userID)
            let choice = LiveQuery(store, initial: nil) { db in
                CrosstuneCommands.storedPlayFirst(try UserSettings.fetchOne(db, key: settings))
            }
            let session = session
            playback?.resolve = ListPlayback.resolver(
                store: store, access: player.appleMusic?.access ?? NoAppleMusic(),
                online: { session?.hasNetwork ?? true },
                playFirst: { choice.value ?? UserSettings.defaultPlayFirst })
        }
    }
}
