import CrosstuneDesign
import SwiftUI

/// A field row that picks from a closed list, with an empty choice first. A stored value the
/// list lacks shows as its own choice, so it is never hidden.
struct SuggestionPicker: View {
    /// The empty choice's tag. No suggestion list can hold it.
    nonisolated static let noneTag = "\u{0}none"

    private let label: String
    private let rowLabel: String
    @Binding private var value: String
    private let options: [String]
    private let emptyLabel: String
    private let reportsRepicks: Bool

    #if !os(macOS)
        @Environment(\.rowsOutsideForm) private var outsideForm
    #endif

    /// - Parameters:
    ///   - label: The field's full name, which is its accessible name.
    ///   - rowLabel: The row's visible label, for a row under a header that already carries half
    ///     the name. Defaults to `label`.
    ///   - emptyLabel: The empty choice, "Not set" unless the field names its own.
    ///   - reportsRepicks: On iPhone and iPad, writes `value` even when the choice already shown
    ///     is picked again, for a field where picking a value is itself the musician's decision.
    ///     A system picker skips that write, so the choices become a menu of buttons instead. The
    ///     Mac always draws that menu.
    init(
        _ label: String, rowLabel: String? = nil, value: Binding<String>, options: [String],
        emptyLabel: String = TuneFieldLabels.notSet, reportsRepicks: Bool = false
    ) {
        self.reportsRepicks = reportsRepicks
        self.label = label
        self.rowLabel = rowLabel ?? label
        _value = value
        self.options = options
        self.emptyLabel = emptyLabel
    }

    /// The choices shown: the options, then a stored value they lack.
    nonisolated static func choices(_ options: [String], value: String) -> [String] {
        value.isEmpty || options.contains(value) ? options : options + [value]
    }

    var body: some View {
        #if os(macOS)
            menu
        #else
            // Outside a form a system picker shows its value without its label, so the row draws
            // its own.
            if reportsRepicks || outsideForm {
                menu
            } else {
                picker
            }
        #endif
    }

    #if !os(macOS)
        private var picker: some View {
            Picker(selection: selection) {
                Text(emptyLabel).tag(Self.noneTag)
                ForEach(Self.choices(options, value: value), id: \.self) { choice in
                    Text(choice).tag(choice)
                }
            } label: {
                Text(rowLabel)
            }
            .accessibilityLabel(label)
            .contentMask()
        }
    #endif

    /// The same choices as a menu row, each of which writes its value whether or not it is shown.
    private var menu: some View {
        let current = selection.wrappedValue
        return MenuRow(label, rowLabel: rowLabel, value: value.isEmpty ? emptyLabel : value, isSet: !value.isEmpty) {
            choice(emptyLabel, tag: Self.noneTag, current: current)
            ForEach(Self.choices(options, value: value), id: \.self) { option in
                choice(option, tag: option, current: current)
            }
        }
    }

    /// A toggle, so the menu checks the current choice; turning it off picks it again.
    private func choice(_ title: String, tag: String, current: String) -> some View {
        Toggle(
            title,
            isOn: Binding {
                tag == current
            } set: { _ in
                selection.wrappedValue = tag
            })
    }

    private var selection: Binding<String> {
        Binding {
            value.isEmpty ? Self.noneTag : value
        } set: { tag in
            value = tag == Self.noneTag ? "" : tag
        }
    }
}

extension EnvironmentValues {
    /// True for form rows laid out on their own rather than in a `Form`, as in an attribute editor.
    @Entry var rowsOutsideForm = false
}

extension View {
    /// Caps the text at `limit` code points, the unit the server counts, as it is typed. Nil
    /// leaves it uncapped.
    func characterLimit(_ limit: Int?, text: Binding<String>) -> some View {
        onChange(of: text.wrappedValue) { _, typed in
            // Written back from here rather than inside the binding, so the field redraws with
            // the capped text instead of keeping the character it just drew.
            if let capped = CharacterLimit.capped(typed, limit: limit) { text.wrappedValue = capped }
        }
    }
}

enum CharacterLimit {
    /// `typed` cut to `limit` code points, or nil when it already fits or there is no limit.
    static func capped(_ typed: String, limit: Int?) -> String? {
        guard let limit, typed.unicodeScalars.count > limit else { return nil }
        return typed.cappedCodePoints(limit)
    }
}
