import Foundation

extension String {
    /// The text without the white space around it, or nil when nothing else is left, as a form
    /// stores a field left blank.
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
