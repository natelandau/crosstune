import Foundation

/// An error's description for a public log line, with the query cut from every URL in it.
///
/// A presigned storage URL carries its signature in the query, and a failed transfer's
/// `URLError` describes itself with the URL it failed on.
func logDescription(of error: any Error) -> String {
    String(describing: error).replacing(#/(https?://[^\s?"'<>]*)\?[^\s"'<>]*/#) { "\($0.1)?…" }
}
