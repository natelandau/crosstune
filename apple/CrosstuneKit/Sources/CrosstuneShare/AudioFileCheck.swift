import Foundation
import UniformTypeIdentifiers

/// Whether a file can be added as a recording. Each refusal is one the server would make for
/// good, so storing the file would only leave a recording stuck on an upload that can never succeed.
public enum AudioFileCheck {
    public static let notAudio = "Choose an audio file."
    public static let emptyFile = "This file is empty."

    public static func tooLarge(_ maxFileBytes: Int) -> String {
        "Files are limited to \(ByteText.bytes(Int64(maxFileBytes)))."
    }

    /// A refusal from a batch of files, named for the file it refused.
    public static func refused(_ fileName: String, _ message: String) -> String {
        "\(fileName): \(message)"
    }

    /// Why a file is refused.
    public enum Reason: LocalizedError, Equatable, Sendable {
        case notAudio
        case emptyFile
        case tooLarge(maxFileBytes: Int)

        public var message: String {
            switch self {
            case .notAudio: AudioFileCheck.notAudio
            case .emptyFile: AudioFileCheck.emptyFile
            case .tooLarge(let maxFileBytes): AudioFileCheck.tooLarge(maxFileBytes)
            }
        }

        public var errorDescription: String? { message }
    }

    /// Why the file is refused, or nil when it is accepted. `maxFileBytes` is nil when the limit
    /// is not known yet. QuickTime audio is accepted, since it is converted to M4A before upload.
    public static func reason(type: UTType?, bytes: Int64, maxFileBytes: Int?) -> Reason? {
        guard let type, isQuickTimeAudio(type) || isUploadableAudio(type) else { return .notAudio }
        guard bytes > 0 else { return .emptyFile }
        if let maxFileBytes, bytes > Int64(maxFileBytes) { return .tooLarge(maxFileBytes: maxFileBytes) }
        return nil
    }

    /// The name to store a shared file under, so its type reads from the name as an upload from
    /// Files is judged, and the recording's label. A name that gives no audio type takes an
    /// extension of the type the sharing app declared, one that reads back as audio. The label
    /// comes from the name as shared, never the added extension.
    public static func fileName(_ name: String, declaredType: UTType?) -> (stored: String, label: String) {
        let label = (name as NSString).deletingPathExtension
        func isAudio(_ fileExtension: String) -> Bool {
            UTType(filenameExtension: fileExtension)?.conforms(to: .audio) == true
        }
        if isAudio((name as NSString).pathExtension) { return (name, label) }
        guard let declaredType, declaredType.conforms(to: .audio) else { return (name, label) }
        // MPEG-4 audio's own extensions, `mp4` and `mpg4`, read back as a movie.
        let fallback = declaredType.conforms(to: .mpeg4Audio) ? "m4a" : nil
        guard let fileExtension = declaredType.tags[.filenameExtension]?.first(where: isAudio) ?? fallback else {
            return (name, label)
        }
        return ("\(name).\(fileExtension)", label)
    }

    /// QuickTime audio, which the app converts to M4A before upload.
    public static func isQuickTimeAudio(_ type: UTType) -> Bool {
        guard let quickTimeAudio = UTType("com.apple.quicktime-audio") else { return false }
        return type.conforms(to: quickTimeAudio)
    }

    private static func isUploadableAudio(_ type: UTType) -> Bool {
        type.conforms(to: .audio) && type.preferredMIMEType?.hasPrefix("audio/") == true
    }
}
