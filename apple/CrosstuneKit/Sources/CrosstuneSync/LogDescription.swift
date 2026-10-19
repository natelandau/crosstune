import CrosstuneDiagnostics
import Foundation

/// An error's description for a public log line, with the query or fragment cut from every URL in it.
func logDescription(of error: any Error) -> String {
    redactingURLQueries(String(describing: error))
}
