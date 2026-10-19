import Foundation

/// `text` with the query or fragment cut from every URL in it.
///
/// A presigned storage URL carries its signature in the query, and a failed transfer's
/// `URLError` describes itself with the URL it failed on.
public func redactingURLQueries(_ text: String) -> String {
    text.replacing(#/(https?://[^\s?#"'<>]*)([?#])[^\s"'<>]*/#) { "\($0.1)\($0.2)…" }
}
