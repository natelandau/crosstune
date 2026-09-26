/// How much of the account's recording quota is in use, kept under `MetaKey.storage` with the
/// web client's keys.
public struct StorageFigures: Codable, Hashable, Sendable {
    public var usedBytes: Int
    public var quotaBytes: Int
    public var maxFileBytes: Int

    public init(usedBytes: Int, quotaBytes: Int, maxFileBytes: Int) {
        self.usedBytes = usedBytes
        self.quotaBytes = quotaBytes
        self.maxFileBytes = maxFileBytes
    }

    enum CodingKeys: String, CodingKey {
        case usedBytes = "used_bytes"
        case quotaBytes = "quota_bytes"
        case maxFileBytes = "max_file_bytes"
    }
}
