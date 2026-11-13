import CrosstuneStore
import Foundation

public struct NameInput: Sendable {
    public var title: String
    public var titleIsDate: Bool
    public var recordedAt: Date?
    public var precision: RecordingPrecision?
    public var fileExtension: String

    public init(
        title: String, titleIsDate: Bool, recordedAt: Date?, precision: RecordingPrecision?,
        fileExtension: String
    ) {
        self.title = title
        self.titleIsDate = titleIsDate
        self.recordedAt = recordedAt
        self.precision = precision
        self.fileExtension = fileExtension
    }
}

extension NameInput {
    /// The recorded date as the file name shows it, also when the title already shows it. Nil
    /// without a date or precision.
    func recordedDateText(local: DateText) -> String? {
        guard let recordedAt, let precision else { return nil }
        return CrosstuneExport.recordedDateText(recordedAt, precision: precision, local: local)
    }

    /// The file name without its extension: the title, then the recorded date unless the title
    /// already shows it.
    func fileStem(local: DateText) -> String {
        guard !titleIsDate, let text = recordedDateText(local: local) else { return title }
        return "\(title) \(text)"
    }
}

/// One name per input, in order. A case-insensitive collision gets ` (2)`, ` (3)`. A `time`
/// precision date is the day in `timeZone`.
public func fileNames(_ inputs: [NameInput], timeZone: TimeZone) -> [String] {
    let local = DateText(timeZone: timeZone)
    var allocator = NameAllocator()
    return inputs.map { allocator.take($0.fileStem(local: local), ext: $0.fileExtension) }
}
