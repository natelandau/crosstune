import SwiftUI

/// One value from two to five options, all visible: the system segmented control on iPhone and
/// iPad, and ``MacSegmented`` on the Mac. `title` names it for VoiceOver.
package struct SegmentedControl<Value: Hashable>: View {
    private let title: String
    @Binding private var selection: Value
    private let options: [Value]
    private let label: (Value) -> String

    package init(
        _ title: String, selection: Binding<Value>, options: [Value], label: @escaping (Value) -> String
    ) {
        self.title = title
        _selection = selection
        self.options = options
        self.label = label
    }

    package var body: some View {
        #if os(macOS)
            MacSegmented(selection: $selection, options: options, label: label, title: title)
        #else
            Picker(title, selection: $selection) {
                ForEach(options, id: \.self) { option in
                    Text(label(option)).tag(option)
                }
            }
            .pickerStyle(.segmented)
        #endif
    }
}

#Preview("Segmented control") {
    @Previewable @State var channel = "Both"
    SegmentedControl("Channel", selection: $channel, options: ["Left", "Both", "Right"]) { $0 }
        .padding()
}
