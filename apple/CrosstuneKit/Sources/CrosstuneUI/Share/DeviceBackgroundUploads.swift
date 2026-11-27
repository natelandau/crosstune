import CrosstuneSync
import Foundation

/// The app target's way to reach the recording upload session, which it does not link directly.
public enum DeviceBackgroundUploads {
    /// Creates the upload session and points it at the API. Call it at launch: the system
    /// delivers finished uploads to a session that exists, and a confirm needs the origin.
    @MainActor
    public static func launch(apiOrigin: URL) {
        BackgroundUploadSession.shared.apiOrigin = apiOrigin
    }

    /// Resumes the upload session for a system wake and calls `completion` once its events are
    /// handled. Any other identifier calls it at once. Call it from the app delegate's
    /// background session hook.
    @MainActor
    public static func handleWake(identifier: String, completion: @escaping @Sendable () -> Void) {
        guard identifier == BackgroundUploadSession.identifier else { return completion() }
        BackgroundUploadSession.shared.wake(completion: completion)
    }
}
