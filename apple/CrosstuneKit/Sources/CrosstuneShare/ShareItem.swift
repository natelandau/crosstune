import Foundation

/// Something shared to Crosstune that the app has not added yet. `sharedAt` is in milliseconds
/// since 1970.
public enum ShareItem: Codable, Equatable, Sendable {
    case link(url: String, title: String?, tune: LinkTune, sharedAt: Int64)
    /// An audio file, stored beside the item as `fileName`. `sharedName` is the name it was shared
    /// under, which a refusal names, since the stored name can carry an added extension.
    case audio(fileName: String, sharedName: String, label: String, sharedAt: Int64)

    /// The tune a link goes to.
    public enum LinkTune: Codable, Equatable, Sendable {
        case existing(id: String, title: String)
        /// A tune made in the share extension, which the app creates with this ID.
        case new(id: String, title: String)
    }

    public var sharedAt: Int64 {
        switch self {
        case .link(_, _, _, let sharedAt), .audio(_, _, _, let sharedAt): sharedAt
        }
    }
}

/// An item in the inbox, with its audio file when it has one.
public struct PendingItem: Sendable {
    public let folder: URL
    public let item: ShareItem
    public var audioFile: URL?
}
