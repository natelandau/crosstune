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
    case linkNotFound
    case loopLimit
    case noRoom
    case recordedDateMismatch
    case recordedDateFuture
    case recordedDateOffPeriod
    case scanLimit

    public static let tuneNotFoundMessage = "Tune not found"
    public static let tuneTitleRequiredMessage = "A tune needs a title"
    public static let listNotFoundMessage = "List not found"
    public static let listNameRequiredMessage = "A list needs a name"
    public static let tuneNotInListMessage = "Tune not found in list"
    public static let recordingNotFoundMessage = "Recording not found"
    public static let linkNotFoundMessage = "Link not found"
    public static let loopLimitMessage = "This recording has 100 loops."
    public static let noRoomMessage = "No room for a loop here."
    public static let recordedDateMismatchMessage = "A recorded date and its precision are set together"
    public static let recordedDateFutureMessage = "A recorded date cannot be in the future"
    public static let recordedDateOffPeriodMessage = "A partial recorded date starts its period at UTC midnight"
    public static let scanLimitMessage = "A tune holds at most 20 scans."

    public var errorDescription: String? {
        switch self {
        case .tuneNotFound: Self.tuneNotFoundMessage
        case .tuneTitleRequired: Self.tuneTitleRequiredMessage
        case .listNotFound: Self.listNotFoundMessage
        case .listNameRequired: Self.listNameRequiredMessage
        case .tuneNotInList: Self.tuneNotInListMessage
        case .recordingNotFound: Self.recordingNotFoundMessage
        case .linkNotFound: Self.linkNotFoundMessage
        case .loopLimit: Self.loopLimitMessage
        case .noRoom: Self.noRoomMessage
        case .recordedDateMismatch: Self.recordedDateMismatchMessage
        case .recordedDateFuture: Self.recordedDateFutureMessage
        case .recordedDateOffPeriod: Self.recordedDateOffPeriodMessage
        case .scanLimit: Self.scanLimitMessage
        }
    }
}
