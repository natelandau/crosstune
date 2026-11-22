import GRDB

/// The columns of a tune the share extension lists.
struct ListedTune: Decodable, FetchableRecord {
    let id: String
    let title: String
    let tuneType: String?
    let key: String?
    let modes: [String]

    enum CodingKeys: String, CodingKey {
        case id, title, key, modes
        case tuneType = "tune_type"
    }
}
