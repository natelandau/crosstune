import CrosstuneAuth
import SwiftUI

/// The signed-out screen: what Crosstune is, then two paths, Create account for anyone new and
/// Sign in for anyone with an account. On iPhone and iPad the picture sits above the words; on
/// the Mac the window splits, picture left on `surface` and words right, centered with the
/// buttons side by side under them, under a window bar with no title.
public struct WelcomeView: View {
    private let notice: String?

    @State private var authMode: AuthMode?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.spacing) private var spacing

    /// `notice` shows above the buttons and is announced to VoiceOver.
    public init(notice: String?) {
        self.notice = notice
    }

    public var body: some View {
        layout
            .screenView(.welcome)
            .sheet(item: $authMode) { mode in
                SignInSheet(mode: mode)
            }
            #if DEBUG
                .opensForSample(.signIn) { authMode = .signIn }
            #endif
    }

    @ViewBuilder private var layout: some View {
        #if os(macOS)
            HStack(spacing: 0) {
                if WelcomeLayout.showsPicture(dynamicTypeSize) {
                    // The picture grows with its pane, so a large window never leaves it small.
                    GeometryReader { pane in
                        PaperEcho(unit: WelcomeLayout.macPictureUnit(paneWidth: pane.size.width))
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(MacPalette.surface.ignoresSafeArea())
                    Rectangle()
                        .fill(MacPalette.hairline)
                        .frame(width: 1)
                        .ignoresSafeArea()
                }
                FillingScroll {
                    macWords
                        .frame(maxWidth: 480, alignment: .leading)
                        .padding(40)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(maxWidth: .infinity)
                .background(MacPalette.ground.ignoresSafeArea())
            }
            .toolbar(removing: .title)
            .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        #else
            FillingScroll {
                VStack(alignment: .leading, spacing: 0) {
                    if WelcomeLayout.showsPicture(dynamicTypeSize) {
                        PaperEcho()
                            .frame(maxWidth: .infinity)
                            .padding(.bottom, spacing(20))
                    }
                    words(for: WelcomeDevice.current)
                }
                .frame(maxWidth: 480)
                .padding(.horizontal, 24)
                .padding(.vertical, spacing(16))
                .frame(maxWidth: .infinity)
            }
        #endif
    }

    #if os(macOS)
        /// The lockup, headline, and line, then the buttons at their own width 24pt under the line.
        private var macWords: some View {
            VStack(alignment: .leading, spacing: 0) {
                Lockup()
                Text(WelcomeCopy.headline(for: .mac))
                    .font(MacStyle.pageTitle)
                    .tracking(MacStyle.pageTitleTracking)
                    .foregroundStyle(MacPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 18)
                Text(WelcomeCopy.line)
                    .font(MacStyle.lead)
                    .foregroundStyle(MacPalette.inkSecondary)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)
                if let notice {
                    Text(notice)
                        .font(MacStyle.body)
                        .foregroundStyle(MacPalette.ink)
                        .padding(.top, 16)
                        .onAppear { AccessibilityNotification.Announcement(notice).post() }
                }
                HStack(spacing: 12) {
                    ForEach(WelcomeButton.allCases) { button in
                        Button(button.label) { authMode = button.mode }
                            .buttonStyle(.mac(button.isProminent ? .primary : .secondary, size: .large))
                    }
                }
                .padding(.top, 24)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    #endif

    #if !os(macOS)
        private func words(for device: WelcomeDevice) -> some View {
            VStack(alignment: .leading, spacing: 0) {
                Lockup()
                Text(WelcomeCopy.headline(for: device))
                    .font(headlineFont(device))
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, spacing(14))
                Text(WelcomeCopy.line)
                    .font(lineFont)
                    .foregroundStyle(.secondary)
                    .padding(.top, spacing.stackGap)
                if let notice {
                    Text(notice)
                        .font(lineFont)
                        .padding(.top, spacing(20))
                        // Nothing here takes first-responder focus, so VoiceOver would not reach the
                        // notice on its own the way a sighted reader does.
                        .onAppear { AccessibilityNotification.Announcement(notice).post() }
                }
                Spacer(minLength: spacing(32))
                buttons
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }

        private func headlineFont(_ device: WelcomeDevice) -> Font {
            device == .mac ? .title.bold() : .title2.bold()
        }

        private var lineFont: Font { .subheadline }

        private var buttons: some View {
            VStack(spacing: spacing(4)) {
                ForEach(WelcomeButton.allCases) { button in
                    Button {
                        authMode = button.mode
                    } label: {
                        Text(button.label)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(WelcomeButtonStyle(prominent: button.isProminent, padding: spacing.stackGap))
                }
            }
            .fontWeight(.semibold)
            .controlSize(.large)
        }
    #endif
}

#if !os(macOS)
    /// The filled slate style for the prominent button, and a borderless one in the tint for the
    /// rest.
    private struct WelcomeButtonStyle: PrimitiveButtonStyle {
        let prominent: Bool
        /// The vertical padding a borderless label takes, which the filled style draws for itself.
        let padding: CGFloat

        @ViewBuilder func makeBody(configuration: Configuration) -> some View {
            if prominent {
                Button(configuration).buttonStyle(.slateProminent)
            } else {
                Button(role: configuration.role, action: configuration.trigger) {
                    configuration.label
                        .foregroundStyle(.tint)
                        .padding(.vertical, padding)
                }
                .buttonStyle(.borderless)
            }
        }
    }
#endif

/// Scrolls its content when it runs taller than the space, and otherwise stretches it to the
/// full height, so a spacer inside can push the buttons to the bottom.
private struct FillingScroll<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                content
                    .frame(minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }
}

#Preview("Welcome") {
    WelcomeView(notice: nil)
}

#Preview("Welcome, account deleted") {
    WelcomeView(notice: DeletedNotice.text)
}
