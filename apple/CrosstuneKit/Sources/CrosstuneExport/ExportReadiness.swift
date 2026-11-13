import Foundation

public enum ExportBlock: Sendable { case capturing, notReady, offline }

public enum ExportReadiness: Equatable, Sendable {
    case local(URL)
    case fetch
    case blocked(ExportBlock)

    public var isBlocked: Bool {
        if case .blocked = self { true } else { false }
    }
}

/// What an export of one recording needs. `localFile` is non-nil only when the device holds a
/// complete file.
public func exportReadiness(state: String, localFile: URL?, isCapturing: Bool, online: Bool) -> ExportReadiness {
    if isCapturing { return .blocked(.capturing) }
    if let localFile { return .local(localFile) }
    if state != "ready" { return .blocked(.notReady) }
    return online ? .fetch : .blocked(.offline)
}
