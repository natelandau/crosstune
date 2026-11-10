#if os(macOS)
    import SwiftUI

    /// A segmented choice in the ``MacSegmented`` token look whose selection can be empty, for a
    /// value the items disagree on. Like the system control it is one keyboard stop whose arrows
    /// move the choice, and VoiceOver reads it as the system's segmented picker.
    package struct MacSegmentedPicker<Value: Hashable>: View {
        private let title: String
        @Binding private var selection: Value?
        private let options: [(value: Value, label: String)]
        private let size: MacButtonStyle.Size

        /// A nil `selection` shows no segment chosen, for a value the items disagree on.
        package init(
            _ title: String, selection: Binding<Value?>, options: [(value: Value, label: String)],
            size: MacButtonStyle.Size = .regular
        ) {
            self.title = title
            _selection = selection
            self.options = options
            self.size = size
        }

        package var body: some View {
            MacSegmentTrack(
                title: title, chosen: selection,
                options: options.map { MacSegmentTrack.Option(value: $0.value, label: $0.label) }, size: size
            ) { selection = $0 }
        }
    }
#endif
