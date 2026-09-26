import SwiftUI

/// A field row that picks from suggestions without ever limiting the musician: `Other…` reveals a
/// text field, and a value typed there shows as its own choice afterwards. Without `Other…` it is
/// a closed list.
struct SuggestionPicker: View {
    /// The empty choice's tag. No suggestion list can hold it.
    nonisolated static let noneTag = "\u{0}none"
    /// The `Other…` choice's tag.
    nonisolated static let otherTag = "\u{0}other"

    private let label: String
    private let rowLabel: String
    @Binding private var value: String
    private let options: [String]
    private let allowsOther: Bool
    private let maxLength: Int?
    private let emptyLabel: String

    /// Whether `Other…` is chosen, so the text field shows even while its text matches a
    /// suggestion.
    @State private var typing = false
    /// Set when Other is chosen, so the field it reveals takes focus once rather than each time
    /// the row scrolls back into view.
    @State private var focusesOther = false
    @FocusState private var otherFocused: Bool
    private let reportsRepicks: Bool

    /// - Parameters:
    ///   - label: The field's full name, which is its accessible name.
    ///   - rowLabel: The row's visible label, for a row under a header that already carries half
    ///     the name. Defaults to `label`.
    ///   - emptyLabel: The empty choice, "Not set" unless the field names its own.
    ///   - reportsRepicks: Writes `value` even when the choice already shown is picked again, for
    ///     a field where picking a value is itself the musician's decision. A system picker skips
    ///     that write, so the choices become a menu of buttons instead.
    init(
        _ label: String, rowLabel: String? = nil, value: Binding<String>, options: [String], allowsOther: Bool,
        maxLength: Int? = nil, emptyLabel: String = TuneFieldLabels.notSet, reportsRepicks: Bool = false
    ) {
        self.reportsRepicks = reportsRepicks
        self.label = label
        self.rowLabel = rowLabel ?? label
        _value = value
        self.options = options
        self.allowsOther = allowsOther
        self.maxLength = maxLength
        self.emptyLabel = emptyLabel
    }

    /// The choices shown: the suggestions, then a stored or typed value they lack.
    nonisolated static func choices(_ options: [String], value: String) -> [String] {
        value.isEmpty || options.contains(value) ? options : options + [value]
    }

    /// The value after choosing `tag`, and whether the Other field shows. Choosing Other keeps a
    /// value the suggestions lack and clears a suggestion, so what is saved is what is shown.
    nonisolated static func choosing(_ tag: String, value: String, options: [String]) -> (value: String, typing: Bool) {
        switch tag {
        case otherTag: (options.contains(value) ? "" : value, true)
        case noneTag: ("", false)
        default: (tag, false)
        }
    }

    var body: some View {
        if reportsRepicks {
            menu
        } else {
            picker
        }
        if typing {
            let otherLabel = TuneFieldLabels.other(label)
            LabeledContent {
                TextField(otherLabel, text: $value, prompt: Text(TuneFieldLabels.notSet))
                    .multilineTextAlignment(.trailing)
                    .focused($otherFocused)
                    .characterLimit(maxLength, text: $value)
                    .onAppear {
                        guard focusesOther else { return }
                        focusesOther = false
                        otherFocused = true
                    }
            } label: {
                Text(otherLabel)
            }
        }
    }

    private var picker: some View {
        Picker(selection: selection) {
            Text(emptyLabel).tag(Self.noneTag)
            ForEach(Self.choices(options, value: value), id: \.self) { choice in
                Text(choice).tag(choice)
            }
            if allowsOther {
                Text(TuneFieldLabels.other).tag(Self.otherTag)
            }
        } label: {
            Text(rowLabel)
        }
        .accessibilityLabel(label)
    }

    /// The same choices as buttons, each of which writes its value whether or not it is shown.
    private var menu: some View {
        let current = selection.wrappedValue
        return LabeledContent {
            Menu {
                choiceButton(emptyLabel, tag: Self.noneTag, current: current)
                ForEach(Self.choices(options, value: value), id: \.self) { choice in
                    choiceButton(choice, tag: choice, current: current)
                }
                if allowsOther {
                    choiceButton(TuneFieldLabels.other, tag: Self.otherTag, current: current)
                }
            } label: {
                HStack(spacing: 4) {
                    Text(value.isEmpty ? emptyLabel : value)
                    Image(systemName: "chevron.up.chevron.down")
                        .imageScale(.small)
                        .accessibilityHidden(true)
                }
                .foregroundStyle(.secondary)
            }
        } label: {
            Text(rowLabel)
        }
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private func choiceButton(_ title: String, tag: String, current: String) -> some View {
        Button {
            selection.wrappedValue = tag
        } label: {
            if tag == current {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }

    private var selection: Binding<String> {
        Binding {
            if typing { return Self.otherTag }
            return value.isEmpty ? Self.noneTag : value
        } set: { tag in
            let next = Self.choosing(tag, value: value, options: options)
            if next.typing && !typing { focusesOther = true }
            typing = next.typing
            value = next.value
        }
    }
}

extension View {
    /// Caps the text at `limit` characters as it is typed. Nil leaves it uncapped.
    func characterLimit(_ limit: Int?, text: Binding<String>) -> some View {
        onChange(of: text.wrappedValue) { _, typed in
            // Written back from here rather than inside the binding, so the field redraws with
            // the capped text instead of keeping the character it just drew.
            if let limit, typed.count > limit { text.wrappedValue = String(typed.prefix(limit)) }
        }
    }
}
