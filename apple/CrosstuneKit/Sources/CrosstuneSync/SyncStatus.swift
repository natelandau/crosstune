import CrosstuneAPI
import Foundation
import OpenAPIRuntime

/// Where the sync loop stands.
public enum SyncStatus: String, CaseIterable, Sendable {
    case idle
    case syncing
    case offline
    case unauthorized
    case error

    /// The label both loops show when there is no connection.
    public static let offlineLabel = "Offline"

    /// What this state is called wherever it is shown.
    public var label: String {
        switch self {
        case .idle: "Synced"
        case .syncing: "Syncing"
        case .offline: Self.offlineLabel
        case .unauthorized: "Sign in again"
        case .error: "Sync failed"
        }
    }
}

/// Where the recording upload and download loop stands.
public enum TransferStatus: String, CaseIterable, Sendable {
    case idle
    case transferring
    case offline
    case error

    /// What this state is called wherever it is shown.
    public var label: String {
        switch self {
        case .idle: "Up to date"
        case .transferring: "Transferring"
        case .offline: SyncStatus.offlineLabel
        case .error: "Transfer failed"
        }
    }
}

extension SyncStatus: LoopStatus {
    static var busy: SyncStatus { .syncing }
}

extension TransferStatus: LoopStatus {
    static var busy: TransferStatus { .transferring }
}

/// The run stopped before any request because the device has no connection.
struct DeviceOffline: Error {}

/// The error a failed request carries, with the generated client's wrapper removed.
func underlying(_ error: any Error) -> any Error {
    (error as? ClientError)?.underlyingError ?? error
}

/// No session token, or the server refusing one: nothing past this point can succeed until the
/// user signs in again.
func isAuthFailure(_ error: any Error) -> Bool {
    switch underlying(error) {
    case is NotSignedIn: true
    case let status as APIStatusError: status.status == 401 || status.status == 403
    default: false
    }
}

/// The status a failed sync run leaves behind.
///
/// A 401 here has already been retried once with a fresh token by `AuthMiddleware`.
func classifyFailure(_ error: any Error, isOffline: Bool) -> SyncStatus {
    if isOffline { return .offline }
    switch underlying(error) {
    // No session token and an unreachable server both mean "not reachable right now", not a bug.
    case is DeviceOffline, is NotSignedIn, is URLError: return .offline
    default: return isAuthFailure(error) ? .unauthorized : .error
    }
}

/// The status a failed transfer run leaves behind.
func classifyTransferFailure(_ error: any Error, isOffline: Bool) -> TransferStatus {
    if isOffline { return .offline }
    switch underlying(error) {
    case is DeviceOffline, is NotSignedIn: return .offline
    // Unlike a sync, an unreachable host while the device has a connection means the storage
    // host refused, which would otherwise sit silently under "offline" forever.
    default: return .error
    }
}
