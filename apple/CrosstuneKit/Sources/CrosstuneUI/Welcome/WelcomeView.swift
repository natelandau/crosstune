import CrosstuneAuth
import SwiftUI

/// The signed-out screen: what Crosstune is, then Sign in for anyone with an account and Join the
/// waitlist for anyone without. On iPhone and iPad the picture sits above the words; on the Mac
/// the window splits, picture left and words right.
public struct WelcomeView: View {
    private let notice: String?

    @State private var showsSignIn = false
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// `notice` shows above the buttons and is announced to VoiceOver.
    public init(notice: String?) {
        self.notice = notice
    }

    public var body: some View {
        layout
            .sheet(isPresented: $showsSignIn) {
                SignInSheet()
            }
    }

    @ViewBuilder private var layout: some View {
        #if os(macOS)
            HStack(spacing: 0) {
                if WelcomeLayout.showsPicture(dynamicTypeSize) {
                    PaperEcho(unit: 14)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.fill.quaternary)
                    Divider()
                }
                FillingScroll {
                    words(for: .mac)
                        .frame(maxWidth: 440)
                        .padding(40)
                }
                .frame(maxWidth: .infinity)
            }
        #else
            FillingScroll {
                VStack(alignment: .leading, spacing: 0) {
                    if WelcomeLayout.showsPicture(dynamicTypeSize) {
                        PaperEcho()
                            .frame(maxWidth: .infinity)
                            .padding(.bottom, 20)
                    }
                    words(for: WelcomeDevice.current)
                }
                .frame(maxWidth: 480)
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
            }
        #endif
    }

    private func words(for device: WelcomeDevice) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Lockup()
            Text(WelcomeCopy.headline(for: device))
                .font(device == .mac ? .title.bold() : .title2.bold())
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 14)
            Text(WelcomeCopy.line)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 8)
            if let notice {
                Text(notice)
                    .font(.subheadline)
                    .padding(.top, 20)
                    // Nothing here takes first-responder focus, so VoiceOver would not reach the
                    // notice on its own the way a sighted reader does.
                    .onAppear { AccessibilityNotification.Announcement(notice).post() }
            }
            Spacer(minLength: 32)
            buttons
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var buttons: some View {
        VStack(spacing: 4) {
            Button {
                showsSignIn = true
            } label: {
                Text(WelcomeCopy.signIn)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Button {
                openURL(WelcomeCopy.waitlistURL)
            } label: {
                Text(WelcomeCopy.joinWaitlist)
                    // A borderless button on the Mac draws in the label color, not the tint.
                    .foregroundStyle(.tint)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.borderless)
        }
        .fontWeight(.semibold)
        .controlSize(.large)
    }
}

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
