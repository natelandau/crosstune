#if os(macOS)
    import SwiftUI

    /// A Mac sidebar section's header with an add button at its trailing edge. A Mac sidebar
    /// exposes a section header to VoiceOver as one heading, so the action needs a menu command
    /// beside it.
    struct SidebarSectionHeader: View {
        let title: String
        let add: String
        let onAdd: () -> Void

        init(_ title: String, add: String, onAdd: @escaping () -> Void) {
            self.title = title
            self.add = add
            self.onAdd = onAdd
        }

        /// A sidebar draws its section headers outside the rows' own insets. These line the title
        /// up with the rows' glyphs and the add control's trailing edge with the rows' counts.
        private static let leadingInset: CGFloat = 7
        private static let trailingInset: CGFloat = 17

        var body: some View {
            HStack {
                Text(title)
                Spacer(minLength: 0)
                Button(add, systemImage: "plus.circle", action: onAdd)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .help(add)
            }
            .padding(.leading, Self.leadingInset)
            .padding(.trailing, Self.trailingInset)
        }
    }
#endif
