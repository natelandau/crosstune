import Foundation

/// Why a command refused to write, with the web client's own wording so both surfaces read the
/// same message.
public enum CommandError: LocalizedError, Equatable, Sendable {
    case tuneNotFound
    case tuneTitleRequired
    case listNotFound
    case listNameRequired
    case tuneNotInList
    case recordingNotFound

    public static let tuneNotFoundMessage = "Tune not found"
    public static let tuneTitleRequiredMessage = "A tune needs a title"
    public static let listNotFoundMessage = "List not found"
    public static let listNameRequiredMessage = "A list needs a name"
    public static let tuneNotInListMessage = "Tune not found in list"
    public static let recordingNotFoundMessage = "Recording not found"

    public var errorDescription: String? {
        switch self {
        case .tuneNotFound: Self.tuneNotFoundMessage
        case .tuneTitleRequired: Self.tuneTitleRequiredMessage
        case .listNotFound: Self.listNotFoundMessage
        case .listNameRequired: Self.listNameRequiredMessage
        case .tuneNotInList: Self.tuneNotInListMessage
        case .recordingNotFound: Self.recordingNotFoundMessage
        }
    }
}
