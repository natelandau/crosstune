import Foundation

/// An RFC 4122 version 5 UUID: SHA-1 over the namespace's bytes and the name, with the version
/// and variant bits set. Matches the `uuid` npm package's `v5`, byte for byte, so a client that
/// hashes the same name and namespace derives the same id as this one.
///
/// Hashed with a small SHA-1 written here rather than CryptoKit's, so this module never links a
/// system crypto framework for a plain identifier derivation.
func uuidV5(name: String, namespace: UUID) -> UUID {
    var input = withUnsafeBytes(of: namespace.uuid) { Data($0) }
    input.append(contentsOf: Array(name.utf8))
    var hash = Array(sha1(input).prefix(16))
    hash[6] = (hash[6] & 0x0F) | 0x50  // version 5
    hash[8] = (hash[8] & 0x3F) | 0x80  // RFC 4122 variant
    return UUID(
        uuid: (
            hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7],
            hash[8], hash[9], hash[10], hash[11], hash[12], hash[13], hash[14], hash[15]
        ))
}

/// SHA-1 of `data`. Not for anything security-sensitive: RFC 4122 uses it only as a stable hash
/// for deriving a name-based id, the one purpose it still serves here.
private func sha1(_ data: Data) -> [UInt8] {
    var h0: UInt32 = 0x6745_2301
    var h1: UInt32 = 0xEFCD_AB89
    var h2: UInt32 = 0x98BA_DCFE
    var h3: UInt32 = 0x1032_5476
    var h4: UInt32 = 0xC3D2_E1F0

    var message = Array(data)
    let bitLength = UInt64(message.count) * 8
    message.append(0x80)
    while message.count % 64 != 56 { message.append(0) }
    for shift in stride(from: 56, through: 0, by: -8) {
        message.append(UInt8((bitLength >> shift) & 0xFF))
    }

    for chunkStart in stride(from: 0, to: message.count, by: 64) {
        var w = [UInt32](repeating: 0, count: 80)
        for i in 0..<16 {
            let base = chunkStart + i * 4
            w[i] =
                (UInt32(message[base]) << 24) | (UInt32(message[base + 1]) << 16)
                | (UInt32(message[base + 2]) << 8) | UInt32(message[base + 3])
        }
        for i in 16..<80 {
            w[i] = rotatedLeft(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], by: 1)
        }

        var a = h0
        var b = h1
        var c = h2
        var d = h3
        var e = h4
        for i in 0..<80 {
            let f: UInt32
            let k: UInt32
            switch i {
            case 0..<20:
                f = (b & c) | (~b & d)
                k = 0x5A82_7999
            case 20..<40:
                f = b ^ c ^ d
                k = 0x6ED9_EBA1
            case 40..<60:
                f = (b & c) | (b & d) | (c & d)
                k = 0x8F1B_BCDC
            default:
                f = b ^ c ^ d
                k = 0xCA62_C1D6
            }
            let temp = rotatedLeft(a, by: 5) &+ f &+ e &+ k &+ w[i]
            e = d
            d = c
            c = rotatedLeft(b, by: 30)
            b = a
            a = temp
        }

        h0 = h0 &+ a
        h1 = h1 &+ b
        h2 = h2 &+ c
        h3 = h3 &+ d
        h4 = h4 &+ e
    }

    return [h0, h1, h2, h3, h4].flatMap { value in (0..<4).map { UInt8((value >> (24 - $0 * 8)) & 0xFF) } }
}

private func rotatedLeft(_ value: UInt32, by amount: UInt32) -> UInt32 {
    (value << amount) | (value >> (32 - amount))
}
