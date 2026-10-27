import SwiftUI

extension EnvironmentValues {
    /// The appearance outside the recording screen whose practice background the screen is drawn
    /// on, or nil where it draws on the window's own background.
    @Entry package var practiceBackground: ColorScheme?
}

extension View {
    /// Puts the recording screen on the practice background for `scheme`, the appearance outside
    /// it, and draws everything on it in dark so it reads on that background in every appearance.
    package func practiceBackground(_ scheme: ColorScheme) -> some View {
        environment(\.practiceBackground, scheme)
            .environment(\.colorScheme, .dark)
    }
}
