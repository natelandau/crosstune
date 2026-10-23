#if os(iOS)
    import SwiftUI

    /// Settings over a compact window, opened from the account button. Its stack lives in the
    /// shell's place, so the sheet reopens on the page it was left on.
    struct SettingsSheet: View {
        @Bindable var place: ShellPlace

        @Environment(\.dismiss) private var dismiss

        var body: some View {
            NavigationStack(path: $place.settingsPath) {
                SettingsRoot()
                    .environment(\.settingsPageShown, SettingsPageRecorder(place: place))
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button(role: .close) { dismiss() }
                        }
                    }
            }
            .shellSheet()
        }
    }
#endif
