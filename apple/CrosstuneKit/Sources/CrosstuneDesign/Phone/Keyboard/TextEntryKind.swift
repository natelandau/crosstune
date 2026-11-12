import SwiftUI

/// What a text field takes. On iPhone and iPad it sets the keyboard, capitalization,
/// autocorrection, and autofill, and adds Done above a keyboard with no Return that closes it.
/// Every text field names its kind, so fields of one kind type the same on every screen. The
/// Mac keeps its own text settings.
public enum TextEntryKind: Sendable {
    /// A title, a name, or a term: a tune, list, recording, loop, place, composer, or genre.
    /// Each word starts with a capital. No autocorrect, since a tradition's names are rarely in
    /// the system dictionary.
    case name
    /// A code in capital letters, such as a part structure. No autocorrect.
    case capitals
    /// Free text of any length: notes, lyrics, pasted text. Return adds a line.
    case prose
    /// A whole number, on the number pad.
    case number
    /// A web address.
    case url
    /// A search or filter query. No autocorrect, which would change what is searched for.
    case search
    /// Text typed exactly as shown, such as a confirmation word.
    case verbatim

    #if os(iOS)
        /// Whether the keyboard has no Return key that ends the edit, so it carries Done.
        var needsDoneButton: Bool {
            switch self {
            case .prose, .number: true
            case .name, .capitals, .url, .search, .verbatim: false
            }
        }

        var keyboardType: UIKeyboardType {
            switch self {
            case .number: .numberPad
            case .url: .URL
            case .name, .capitals, .prose, .search, .verbatim: .default
            }
        }

        var capitalization: TextInputAutocapitalization {
            switch self {
            case .name: .words
            case .capitals: .characters
            case .prose: .sentences
            case .number, .url, .search, .verbatim: .never
            }
        }

        var autocorrects: Bool {
            self == .prose
        }

        var contentType: UITextContentType? {
            self == .url ? .URL : nil
        }
    #endif
}

extension View {
    /// Types this text field as `kind`. See ``TextEntryKind``.
    public func textEntry(_ kind: TextEntryKind) -> some View {
        #if os(iOS)
            keyboardType(kind.keyboardType)
                .textInputAutocapitalization(kind.capitalization)
                .autocorrectionDisabled(!kind.autocorrects)
                .textContentType(kind.contentType)
                .modifier(KeyboardDoneButton(isShown: kind.needsDoneButton))
        #else
            self
        #endif
    }
}
