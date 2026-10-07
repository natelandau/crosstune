import Foundation

/// The text a failed action shows: the error's own description where it has one written for
/// the musician, and ``CatalogModel/actionFailed`` for anything else, which would otherwise
/// read as a raw system code.
@MainActor
func failureMessage(_ error: any Error) -> String {
    if let description = (error as? LocalizedError)?.errorDescription { return description }
    // Bridged Foundation errors are not `LocalizedError`, but network and file failures say
    // what went wrong in words, such as "The Internet connection appears to be offline." or
    // "The file couldn't be saved because there isn't enough space."
    if let error = error as? URLError { return error.localizedDescription }
    if let error = error as? CocoaError { return error.localizedDescription }
    return CatalogModel.actionFailed
}
