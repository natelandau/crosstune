import Foundation

/// A new row ID: a lowercase UUIDv7, as the web client makes, so IDs from either client sort
/// by creation time. Lowercase because the API returns IDs lowercase and a local row must
/// match its pulled copy as text.
public func newID(at time: Timestamp = .now) -> String {
    var bytes = (0..<16).map { _ in UInt8.random(in: .min ... .max) }
    let milliseconds = UInt64(time.milliseconds)
    for index in 0..<6 {
        bytes[index] = UInt8(truncatingIfNeeded: milliseconds >> (40 - 8 * index))
    }
    bytes[6] = (bytes[6] & 0x0F) | 0x70  // version 7
    bytes[8] = (bytes[8] & 0x3F) | 0x80  // RFC 9562 variant
    let uuid = UUID(
        uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    return uuid.uuidString.lowercased()
}
