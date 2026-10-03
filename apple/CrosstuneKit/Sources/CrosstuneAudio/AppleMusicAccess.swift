import MusicKit
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "apple-music")

/// Whether this device may play Apple Music recordings in full: asked or not, allowed or not,
/// and with a subscription that plays the catalog or not.
public enum AppleMusicAccessState: Equatable, Sendable {
    case notAsked
    case fullTracks
    case noSubscription
    case declined

    static func make(authorization: MusicAuthorization.Status, canPlayCatalogContent: Bool) -> Self {
        switch authorization {
        case .notDetermined: .notAsked
        case .authorized: canPlayCatalogContent ? .fullTracks : .noSubscription
        case .denied, .restricted: .declined
        @unknown default: .declined
        }
    }
}

/// Reads and asks for this device's Apple Music access. ``DeviceAppleMusicAccess`` is the
/// device's; a test stands in its own.
@MainActor
public protocol AppleMusicAccess: AnyObject {
    func current() async -> AppleMusicAccessState
    /// Shows the system prompt when access was never asked for; otherwise the same as
    /// ``current()``.
    func request() async -> AppleMusicAccessState
}

/// The Apple Account signed in on this device, as MusicKit reports it.
@MainActor
public final class DeviceAppleMusicAccess: AppleMusicAccess {
    public init() {}

    public func current() async -> AppleMusicAccessState {
        let status = MusicAuthorization.currentStatus
        guard status == .authorized else {
            return .make(authorization: status, canPlayCatalogContent: false)
        }
        // A subscription that cannot be read, offline for one, plays previews.
        let canPlay: Bool
        do {
            canPlay = try await MusicSubscription.current.canPlayCatalogContent
        } catch {
            logger.error("The Apple Music subscription could not be read: \(error, privacy: .public)")
            canPlay = false
        }
        if !canPlay { logger.notice("This Apple Account cannot play the Apple Music catalog") }
        return .make(authorization: status, canPlayCatalogContent: canPlay)
    }

    public func request() async -> AppleMusicAccessState {
        if MusicAuthorization.currentStatus == .notDetermined {
            _ = await MusicAuthorization.request()
        }
        return await current()
    }
}
