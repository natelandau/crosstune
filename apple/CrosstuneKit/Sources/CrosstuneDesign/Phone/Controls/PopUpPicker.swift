import SwiftUI

/// One value from a closed list, shown as the current value that opens a menu: the system picker
/// on iPhone and iPad, and ``MacPopUp`` on the Mac.
package struct PopUpPicker<Value: Hashable>: View {
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
            MacPopUp(title, selection: $selection, options: options, label: label)
        #else
            Picker(title, selection: $selection) {
                ForEach(options, id: \.self) { option in
                    Text(label(option)).tag(option)
                }
            }
        #endif
    }
}

#Preview("Pop-up picker") {
    @Previewable @State var choice = "Medium"
    Form {
        PopUpPicker("Choice", selection: $choice, options: ["Easy", "Medium", "Hard"]) { $0 }
    }
}
