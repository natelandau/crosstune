import SwiftUI

/// Where focus sits while a ``TextFieldDoneGroup``'s field is edited: the field, or its Done,
/// which keyboard navigation can reach without ending the edit.
package enum TextFieldDoneFocus: Hashable {
    case field, done

    /// Whether the field is being edited, with focus on the field or on its Done.
    package nonisolated static func isEditing(_ focus: Self?) -> Bool {
        focus != nil
    }
}

/// A text field with a line under it, holding a Done button, while the field is edited. The
/// field and its Done are one focus group: focus moving from one to the other keeps the edit
/// open, and Done ends it. The group owns the focus, and the view only hears whether the field
/// is being edited.
package struct TextFieldDoneGroup<Field: View, Line: View>: View {
    private let doneTitle: String
    private let spacing: CGFloat
    private let onEditingChange: (Bool) -> Void
    private let field: (Bool) -> Field
    private let line: (TextFieldDoneButton) -> Line

    @FocusState private var focus: TextFieldDoneFocus?

    /// - Parameters:
    ///   - doneTitle: The Done button's title.
    ///   - spacing: The space between the field and the line.
    ///   - onEditingChange: Runs with whether the field is being edited, each time that changes.
    ///   - field: The field, handed whether it is being edited in the same update as its focus.
    ///   - line: The line under the field while it is edited, handed the Done button to place.
    package init(
        doneTitle: String, spacing: CGFloat, onEditingChange: @escaping (Bool) -> Void,
        @ViewBuilder field: @escaping (Bool) -> Field, @ViewBuilder line: @escaping (TextFieldDoneButton) -> Line
    ) {
        self.doneTitle = doneTitle
        self.spacing = spacing
        self.onEditingChange = onEditingChange
        self.field = field
        self.line = line
    }

    package var body: some View {
        let isEditing = TextFieldDoneFocus.isEditing(focus)
        VStack(alignment: .leading, spacing: spacing) {
            field(isEditing)
                .focused($focus, equals: .field)
                #if os(iOS)
                    .environment(\.fieldOffersDone, true)
                #endif
            if isEditing {
                line(TextFieldDoneButton(title: doneTitle, focus: $focus))
            }
        }
        .onChange(of: isEditing) { _, editing in onEditingChange(editing) }
    }
}

/// A ``TextFieldDoneGroup``'s Done: a Text button that ends the edit.
package struct TextFieldDoneButton: View {
    fileprivate let title: String
    fileprivate let focus: FocusState<TextFieldDoneFocus?>.Binding

    package var body: some View {
        Button(title) { focus.wrappedValue = nil }
            .focused(focus, equals: .done)
            .buttonStyle(.text(oneLine: true))
    }
}
