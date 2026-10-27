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
        /// A suggestion chosen from the Mac's list, for a field that acts on a pick.
        case pick(String)
    }

    /// The text the Mac's Keep suggestion completes to. No typed value can hold it.
    nonisolated static let keepToken = "\u{0}keep"
    /// What starts the text a Mac suggestion completes to in a field that acts on a pick, so the
    /// pick reads apart from typing. No typed value can hold it.
    nonisolated static let pickToken = "\u{0}pick:"
    /// The most suggestion rows shown under a focused field on iOS, so a long catalog list never
    /// pushes the rest of the form away. Typing narrows to the rest.
    nonisolated static let rowLimit = 6

    private let label: String
    private let rowLabel: String
    @Binding private var value: String
    private let suggestions: [String]
    private let maxLength: Int?
    private let keep: Keep?
    private let focus: FocusState<Bool>.Binding?
    private let onPick: ((String) -> Void)?

    @FocusState private var focused: Bool
    #if os(iOS)
        @Environment(\.rowsOutsideForm) private var outsideForm
    #endif

    /// - Parameters:
    ///   - label: The field's full name, which is its accessible name.
    ///   - rowLabel: The row's visible label, for a row under a header that already carries half
    ///     the name. Defaults to `label`.
    ///   - focus: The field's focus, for a caller that moves it; the field holds its own without.
    ///   - onPick: Runs with a chosen suggestion in place of setting `value`, for a field where a
    ///     pick is itself a decision, such as one that saves and closes an editor.
    init(
        _ label: String, rowLabel: String? = nil, value: Binding<String>, suggestions: [String],
        maxLength: Int? = nil, keep: Keep? = nil, focus: FocusState<Bool>.Binding? = nil,
        onPick: ((String) -> Void)? = nil
    ) {
        self.label = label
        self.rowLabel = rowLabel ?? label
        _value = value
        self.suggestions = suggestions
        self.maxLength = maxLength
        self.keep = keep
        self.focus = focus
        self.onPick = onPick
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
        if text.hasPrefix(pickToken) { return .pick(String(text.dropFirst(pickToken.count))) }
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
            if isFocused.wrappedValue {
                if let keep, !keep.kept {
                    Button(keep.label) {
                        keep.onKeep()
                        isFocused.wrappedValue = false
                    }
                    .modifier(SuggestionRow(outsideForm: outsideForm))
                }
                ForEach(Self.matches(suggestions, typed: text.wrappedValue).prefix(Self.rowLimit), id: \.self) {
                    suggestion in
                    Button {
                        if let onPick { onPick(suggestion) } else { text.wrappedValue = suggestion }
                        isFocused.wrappedValue = false
                    } label: {
                        Text(suggestion)
                            .contentMask()
                    }
                    .modifier(SuggestionRow(outsideForm: outsideForm))
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
            .focused(isFocused)
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
                        .textInputCompletion(onPick == nil ? suggestion : Self.pickToken + suggestion)
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

    private var isFocused: FocusState<Bool>.Binding { focus ?? $focused }

    private var text: Binding<String> {
        Binding {
            keep?.kept == true ? "" : value
        } set: { typed in
            switch Self.edit(typed, kept: keep?.kept == true) {
            case .keep: keep?.onKeep()
            case .set(let next): value = next
            case .pick(let picked): if let onPick { onPick(picked) } else { value = picked }
            case nil: break
            }
        }
    }
}

#if os(iOS)
    /// A suggestion row. In a form it is the form's own row; outside one it draws as a list row
    /// would, the full width pressable at a touch's height under a hairline, rather than as a
    /// bare tinted button.
    private struct SuggestionRow: ViewModifier {
        let outsideForm: Bool

        func body(content: Content) -> some View {
            if outsideForm {
                content.buttonStyle(SuggestionRowStyle())
            } else {
                content
            }
        }
    }

    private struct SuggestionRowStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            VStack(spacing: 0) {
                Divider()
                configuration.label
                    .foregroundStyle(.textPrimary)
                    .frame(maxWidth: .infinity, minHeight: minimumTapTarget, alignment: .leading)
                    .contentShape(.rect)
            }
            .opacity(configuration.isPressed ? 0.6 : 1)
        }
    }
#endif
