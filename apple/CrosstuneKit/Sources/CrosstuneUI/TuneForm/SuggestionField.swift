import CrosstuneVocabulary
import SwiftUI

/// An open vocabulary as a field row: the musician types the value straight in, and suggestions
/// that narrow as they type set it in one pick. A value no suggestion holds is as good as one
/// that does. An empty field is empty, and deleting the text empties it.
///
/// The Mac lists the suggestions under the field with the system's text input suggestions. iOS
/// has no such list, so the matches show as rows under the field while it has focus.
struct SuggestionField: View {
    /// A choice that leaves the field as it is, for a row over values that disagree.
    struct Keep {
        let label: String
        /// True while the field is left as it is, so the empty field shows `label` as its prompt.
        let kept: Bool
        let onKeep: () -> Void
    }

    /// What a write to the field means.
    enum Edit: Equatable {
        case keep
        case set(String)
    }

    /// The text the Mac's Keep suggestion completes to. No typed value can hold it.
    nonisolated static let keepToken = "\u{0}keep"
    /// The most suggestion rows shown under a focused field on iOS, so a long catalog list never
    /// pushes the rest of the form away. Typing narrows to the rest.
    nonisolated static let rowLimit = 6

    private let label: String
    private let rowLabel: String
    @Binding private var value: String
    private let suggestions: [String]
    private let maxLength: Int?
    private let keep: Keep?

    @FocusState private var focused: Bool

    /// - Parameters:
    ///   - label: The field's full name, which is its accessible name.
    ///   - rowLabel: The row's visible label, for a row under a header that already carries half
    ///     the name. Defaults to `label`.
    init(
        _ label: String, rowLabel: String? = nil, value: Binding<String>, suggestions: [String],
        maxLength: Int? = nil, keep: Keep? = nil
    ) {
        self.label = label
        self.rowLabel = rowLabel ?? label
        _value = value
        self.suggestions = suggestions
        self.maxLength = maxLength
        self.keep = keep
    }

    /// The suggestions offered for `typed`: all of them while it is empty, else those holding it,
    /// ignoring case and accents. Never the typed text itself, which is already the value.
    nonisolated static func matches(_ suggestions: [String], typed: String) -> [String] {
        guard !typed.isEmpty else { return suggestions }
        return suggestions.filter { $0 != typed && containsText($0, typed) }
    }

    /// What writing `text` to the field does, or nil when it changes nothing: a kept field reads
    /// empty, so an empty write to it is the field settling rather than the musician clearing it.
    nonisolated static func edit(_ text: String, kept: Bool) -> Edit? {
        if text == keepToken { return .keep }
        if kept && text.isEmpty { return nil }
        return .set(text)
    }

    var body: some View {
        LabeledContent {
            field
        } label: {
            Text(rowLabel)
        }
        #if os(iOS)
            if focused {
                if let keep, !keep.kept {
                    Button(keep.label) {
                        keep.onKeep()
                        focused = false
                    }
                }
                ForEach(Self.matches(suggestions, typed: text.wrappedValue).prefix(Self.rowLimit), id: \.self) {
                    suggestion in
                    Button {
                        text.wrappedValue = suggestion
                        focused = false
                    } label: {
                        Text(suggestion)
                            .contentMask()
                    }
                }
            }
        #endif
    }

    private var field: some View {
        TextField(label, text: text, prompt: prompt.map { Text($0) })
            .contentMask()
            #if os(macOS)
                // The row's own label names the field, so the field draws only its value.
                .labelsHidden()
                .textFieldStyle(.macField)
            #else
                .multilineTextAlignment(.trailing)
            #endif
            .focused($focused)
            .characterLimit(maxLength, text: text)
            #if os(macOS)
                .textInputSuggestions {
                    if let keep, !keep.kept {
                        Text(keep.label)
                        .textInputCompletion(Self.keepToken)
                    }
                    ForEach(Self.matches(suggestions, typed: text.wrappedValue), id: \.self) { suggestion in
                        Text(suggestion)
                        .contentMask()
                        .textInputCompletion(suggestion)
                    }
                }
            #endif
    }

    /// The field's prompt: the Keep label while kept. With nothing kept, the Mac says Not set,
    /// since its field hides its own label, and iOS shows none.
    private var prompt: String? {
        guard let keep, keep.kept else {
            #if os(macOS)
                return TuneFieldLabels.notSet
            #else
                return nil
            #endif
        }
        return keep.label
    }

    private var text: Binding<String> {
        Binding {
            keep?.kept == true ? "" : value
        } set: { typed in
            switch Self.edit(typed, kept: keep?.kept == true) {
            case .keep: keep?.onKeep()
            case .set(let next): value = next
            case nil: break
            }
        }
    }
}
