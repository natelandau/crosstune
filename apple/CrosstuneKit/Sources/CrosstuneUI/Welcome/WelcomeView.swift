import CrosstuneAnalytics
import CrosstuneAuth
import Observation
import SwiftUI

/// The signed-out screen: a carousel of what Crosstune does over the account it asks for, with
/// the reason for it, three equal ways to sign up, a way in for anyone with an account, and why
/// an account is needed. A narrow or short window takes one column, the account at the bottom;
/// a wide one splits, carousel left and account right, as the Mac window does under
/// a window bar with no title.
public struct WelcomeView: View {
    private let notice: String?
    private let signUp: NativeSignUp

    @Environment(\.analytics) private var analytics

    /// `notice` shows above the sign-up buttons and is announced to VoiceOver. `signUp` runs the
    /// Apple and Google flows, replaced in previews.
    public init(notice: String?, signUp: NativeSignUp = .live) {
        self.notice = notice
        self.signUp = signUp
    }

    public var body: some View {
        WelcomeContent(analytics: analytics, signUp: signUp, notice: notice)
            .screenView(.welcome)
    }
}

/// Which slide shows, and what each of the welcome screen's controls opens.
@MainActor
@Observable
final class WelcomeModel {
    var carousel = WelcomeCarousel()
    /// The shown slide, writable so a swipe moves the carousel and records the furthest.
    var currentSlide: WelcomeSlide {
        get { carousel.current }
        set { carousel.show(newValue) }
    }
    /// Clerk's flow, while it is open over the screen.
    var authMode: AuthMode?
    var showsReason = false
    /// Why the last sign-up failed, cleared by the next.
    private(set) var failure: String?

    private let analytics: AnalyticsClient
    private let nativeSignUp: NativeSignUp
    /// The button whose native flow is running, which holds every sign-up button until it ends.
    private(set) var signingUp: SignUpButton?

    init(analytics: AnalyticsClient, signUp: NativeSignUp) {
        self.analytics = analytics
        self.nativeSignUp = signUp
    }

    /// Starts `button`'s sign-up. Email opens Clerk's form; Apple and Google run natively and
    /// fall back to the form when Clerk needs more than the provider gave.
    func signUp(with button: SignUpButton) async {
        // A second tap while Apple's sheet or Google's page is up would start a second flow.
        guard signingUp == nil else { return }
        analytics.send(.signUpStarted(method: button.method, furthestSlide: carousel.furthest.name))
        failure = nil
        guard let provider = button.provider else {
            authMode = .signUp
            return
        }
        signingUp = button
        defer { signingUp = nil }
        do {
            switch try await nativeSignUp.run(provider) {
            // The session's arrival replaces this screen.
            case .signedIn: break
            case .cancelled: break
            // Clerk's sign-in-or-up form, since the account behind it may be new or existing.
            case .needsForm: authMode = .signIn
            }
        } catch {
            failure = failureMessage(error)
        }
    }

    /// The notice the screen shows: the last sign-up's failure over the one the app handed in.
    func shownNotice(handedIn: String?) -> WelcomeNotice? {
        if let failure { return .failure(failure) }
        return handedIn.map(WelcomeNotice.info)
    }

    func signIn() {
        authMode = .signIn
    }

    func openReason() {
        analytics.send(.accountReasonOpened)
        showsReason = true
    }
}

/// A line the welcome screen shows over its sign-up buttons.
enum WelcomeNotice: Equatable {
    /// News from the app, such as an account just deleted, in the screen's own text color.
    case info(String)
    /// A failed sign-up, as every failure shows beside its control.
    case failure(String)
}

private struct WelcomeContent: View {
    @State private var model: WelcomeModel
    /// The notice the app hands in, such as an account just deleted.
    let notice: String?

    /// Builds the model here rather than on appear, so the first frame draws the screen.
    init(analytics: AnalyticsClient, signUp: NativeSignUp, notice: String?) {
        _model = State(initialValue: WelcomeModel(analytics: analytics, signUp: signUp))
        self.notice = notice
    }

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.spacing) private var spacing
    /// How far below its pane's top the carousel starts, which the account pane matches so both
    /// panes start at one height.
    @State private var slidesTop: CGFloat = 0
    #if os(macOS)
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(\.controlActiveState) private var controlActiveState
        @FocusState private var carouselFocused: Bool
        /// Whether focus last reached the carousel by keyboard rather than by the screen itself.
        @State private var focusedByKeyboard = false
        /// Set while the screen moves focus to the carousel, so that arrival draws no ring.
        @State private var focusingQuietly = false
    #else
        /// The phone column's lockup height, and the height of everything under it but the
        /// stage, which together leave the stage its height. Unmeasured, the stage draws at its
        /// least.
        @State private var columnLockupHeight: CGFloat = 0
        @State private var columnBlockRest: CGFloat = .infinity
    #endif

    var body: some View {
        layout
            .sheet(item: $model.authMode) { mode in
                SignInSheet(mode: mode)
            }
            .sheet(isPresented: $model.showsReason) {
                AccountReasonSheet()
            }
            #if DEBUG
                .opensForSample(.signIn) { model.signIn() }
            #endif
    }

    private var shownNotice: WelcomeNotice? { model.shownNotice(handedIn: notice) }

    /// The failure, if any, set right above the buttons it concerns.
    private var failure: String? {
        if case .failure(let text) = shownNotice { text } else { nil }
    }

    private var info: String? {
        if case .info(let text) = shownNotice { text } else { nil }
    }

    private var showsPicture: Bool { WelcomeLayout.showsPicture(dynamicTypeSize) }

    private func start(_ button: SignUpButton) {
        Task { await model.signUp(with: button) }
    }

    @ViewBuilder private var layout: some View {
        #if os(macOS)
            HStack(spacing: 0) {
                macCarousel
                    // The window narrows no further than the smallest drawing and its margins.
                    .frame(minWidth: 22.4 * WelcomeLayout.macMinimumUnit + 2 * 24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background { Palette.pageBackground.ignoresSafeArea() }
                Rectangle()
                    .fill(Palette.border)
                    .frame(width: 1)
                    .ignoresSafeArea()
                FillingScroll {
                    macAccount
                        .frame(maxWidth: Self.macAccountWidth, alignment: .leading)
                        .padding(.horizontal, Self.macMargin)
                        .padding(.top, max(slidesTop, Self.macMargin))
                        .padding(.bottom, Self.macMargin)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }
                // Room for the sign-up buttons' titles on one line.
                .frame(minWidth: 320, maxWidth: .infinity)
                .background { Palette.pageBackground.ignoresSafeArea() }
            }
            .toolbar(removing: .title)
            .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        #else
            GeometryReader { window in
                if WelcomeLayout.splits(window.size) {
                    split
                } else {
                    column(window.size)
                }
            }
        #endif
    }

    #if os(macOS)
        /// The height the headline and the controls under it keep clear of the drawing.
        private static let macReserved: CGFloat = 260
        /// The account column's reading width, wide enough that its buttons fill it.
        private static let macAccountWidth: CGFloat = 380
        private static let macMargin: CGFloat = 40

        /// The slide, then the arrows either side of the dots. The arrow keys page it too. Scrolls
        /// when the window is too short for the smallest drawing and its headline.
        private var macCarousel: some View {
            GeometryReader { pane in
                let unit = WelcomeLayout.pictureUnit(
                    pane: pane.size, reserved: Self.macReserved, minimum: WelcomeLayout.macMinimumUnit)
                ScrollView {
                    macSlides(unit: unit)
                        .onGeometryChange(for: CGFloat.self) {
                            $0.frame(in: .named(WelcomeLayout.slidesSpace)).minY
                        } action: {
                            slidesTop = $0
                        }
                        .frame(maxWidth: .infinity, minHeight: pane.size.height)
                        .coordinateSpace(.named(WelcomeLayout.slidesSpace))
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .focusable()
            .focused($carouselFocused)
            // The pane would take the system ring; the dots draw the Mac's own instead.
            .focusEffectDisabled()
            .onKeyPress(.leftArrow) {
                focusedByKeyboard = true
                model.carousel.previous()
                return .handled
            }
            .onKeyPress(.rightArrow) {
                focusedByKeyboard = true
                model.carousel.next()
                return .handled
            }
            .onChange(of: carouselFocused) {
                focusedByKeyboard = WelcomeLayout.focusArrivedByKeyboard(
                    focused: carouselFocused, quietly: focusingQuietly, event: NSApp.currentEvent?.type)
                focusingQuietly = false
            }
            .onAppear { focusCarousel() }
            // Focus goes back to the carousel when a sheet closes, so the arrow keys still page it.
            .onChange(of: model.authMode) { if model.authMode == nil { focusCarousel() } }
            .onChange(of: model.showsReason) { if !model.showsReason { focusCarousel() } }
        }

        /// Gives the carousel the keys without a ring, which waits for the person to use them.
        private func focusCarousel() {
            guard !carouselFocused else { return }
            focusingQuietly = true
            carouselFocused = true
        }

        private var showsFocusRing: Bool {
            WelcomeLayout.showsFocusRing(
                focused: carouselFocused, windowIsKey: controlActiveState == .key, byKeyboard: focusedByKeyboard)
        }

        private func macSlides(unit: CGFloat) -> some View {
            VStack(spacing: 20) {
                ZStack(alignment: .topLeading) {
                    // Every slide laid out unseen, so the block takes the tallest headline's
                    // height and the controls never move between slides.
                    ForEach(WelcomeSlide.allCases) { slide in
                        SlidePage(slide: slide, showsPicture: showsPicture, unit: unit).hidden()
                    }
                    SlidePage(slide: model.carousel.current, showsPicture: showsPicture, unit: unit)
                        .id(model.carousel.current)
                        .transition(.opacity)
                }
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: model.carousel.current)
                HStack(spacing: 8) {
                    let current = model.carousel.current
                    arrow(WelcomeCopy.previousSlide, symbol: "chevron.left", shows: current != .intro) {
                        model.carousel.previous()
                    }
                    // The ring hugs the dots the arrow keys move, so a hidden end arrow never
                    // leaves an empty side inside it.
                    CarouselDots(current: current) { model.carousel.show($0) }
                        .padding(2)
                        .macFocusRing(showsFocusRing, cornerRadius: MacButtonStyle.radius)
                    arrow(
                        WelcomeCopy.nextSlide, symbol: "chevron.right",
                        shows: current != WelcomeSlide.allCases.last
                    ) {
                        model.carousel.next()
                    }
                }
            }
            .frame(width: 22.4 * unit)
        }

        /// An arrow that keeps its place at the end it cannot pass, so the dots never shift.
        private func arrow(
            _ label: String, symbol: String, shows: Bool, action: @escaping () -> Void
        ) -> some View {
            Button {
                action()
                // An arrow that reaches its end turns off, which would drop keyboard focus.
                focusCarousel()
            } label: {
                Label(label, systemImage: symbol)
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.mac(.icon))
            .help(label)
            .opacity(shows ? 1 : 0)
            .disabled(!shows)
            .accessibilityHidden(!shows)
        }

        /// The lockup, the reason, the three sign-up buttons at one width, then the two links.
        private var macAccount: some View {
            VStack(alignment: .leading, spacing: 0) {
                Lockup()
                Text(WelcomeCopy.reason(for: .mac))
                    .font(MacStyle.lead)
                    .foregroundStyle(Palette.textPrimary)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 24)
                if let info {
                    noticeText(info)
                        .font(MacStyle.body.weight(.semibold))
                        .foregroundStyle(Palette.textPrimary)
                        .padding(.top, 16)
                }
                VStack(alignment: .leading, spacing: 8) {
                    if let failure { failureText(failure) }
                    VStack(spacing: 10) {
                        ForEach(SignUpButton.allCases) { button in
                            Button {
                                start(button)
                            } label: {
                                SignUpButtonLabel(button: button, isRunning: model.signingUp == button)
                            }
                            .buttonStyle(SignUpButtonStyle(isRunning: model.signingUp == button))
                            .disabled(model.signingUp != nil)
                        }
                    }
                }
                .padding(.top, 24)
                Button(WelcomeCopy.alreadyHaveAccount) { model.signIn() }
                    .buttonStyle(.mac(.plain))
                    .padding(.top, 16)
                // The accent as on iPhone and iPad, a size down from the sign-in link.
                Button(WelcomeCopy.whyLink) { model.openReason() }
                    .buttonStyle(.mac(.plain, size: .small))
                    .padding(.top, 4)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    #else
        private static let margin: CGFloat = 24
        /// The height the headline and the dots under it keep clear of the drawing.
        private static let paneReserved: CGFloat = 220

        private static let columnMaxWidth: CGFloat = 480

        /// One column, the account at the bottom in thumb reach. The stage takes the height the
        /// rest leaves, so a tall phone's spare height goes to the drawing; what the stage cannot
        /// take goes under the lockup.
        private func column(_ window: CGSize) -> some View {
            let unit = WelcomeLayout.columnUnit(
                width: min(window.width - 2 * Self.margin, Self.columnMaxWidth),
                height: window.height - 2 * spacing(16),
                rest: columnLockupHeight + spacing(16) + columnBlockRest)
            let stageHeight = showsPicture ? 17 * unit : 0
            return FillingScroll {
                VStack(alignment: .leading, spacing: 0) {
                    Lockup()
                        .onGeometryChange(for: CGFloat.self) {
                            $0.size.height
                        } action: {
                            columnLockupHeight = $0
                        }
                    Spacer(minLength: spacing(16))
                    VStack(alignment: .leading, spacing: 0) {
                        phoneCarousel(unit: unit)
                        CarouselDots(current: model.carousel.current) { model.carousel.show($0) }
                            .frame(maxWidth: .infinity)
                        Spacer(minLength: spacing(16))
                            .frame(maxHeight: spacing(24))
                        account
                    }
                    .onGeometryChange(for: CGFloat.self) {
                        $0.size.height
                    } action: {
                        columnBlockRest = $0 - stageHeight
                    }
                }
                .frame(maxHeight: .infinity, alignment: .top)
                .frame(maxWidth: Self.columnMaxWidth)
                .padding(.horizontal, Self.margin)
                .padding(.vertical, spacing(16))
                .frame(maxWidth: .infinity)
            }
        }

        /// The Mac's two panes: the carousel, its drawing scaled to the pane, and the
        /// account beside it.
        private var split: some View {
            HStack(spacing: 0) {
                paneCarousel
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background { Palette.pageBackground.ignoresSafeArea() }
                Rectangle()
                    .fill(Palette.border)
                    .frame(width: 1)
                    .ignoresSafeArea()
                FillingScroll {
                    VStack(alignment: .leading, spacing: spacing(24)) {
                        Lockup()
                        account
                    }
                    .frame(maxWidth: 400)
                    .padding(.horizontal, Self.margin)
                    .padding(.top, max(slidesTop, spacing(24)))
                    .padding(.bottom, spacing(24))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }
                .frame(maxWidth: .infinity)
            }
        }

        /// The slides paged across the whole pane, each centered at the drawing's width, over the
        /// dots. Scrolls when the pane is too short for the smallest drawing and its headline.
        private var paneCarousel: some View {
            GeometryReader { pane in
                let unit = WelcomeLayout.pictureUnit(
                    pane: pane.size, reserved: Self.paneReserved, minimum: WelcomeLayout.phoneUnit)
                ScrollView {
                    VStack(spacing: spacing(16)) {
                        ZStack(alignment: .topLeading) {
                            ForEach(WelcomeSlide.allCases) { slide in
                                SlidePage(slide: slide, showsPicture: showsPicture, unit: unit).hidden()
                            }
                        }
                        .frame(width: 22.4 * unit)
                        .frame(maxWidth: .infinity)
                        .overlay {
                            TabView(selection: $model.currentSlide) {
                                ForEach(WelcomeSlide.allCases) { slide in
                                    SlidePage(slide: slide, showsPicture: showsPicture, unit: unit)
                                        .frame(width: 22.4 * unit)
                                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                                        .tag(slide)
                                }
                            }
                            .tabViewStyle(.page(indexDisplayMode: .never))
                        }
                        CarouselDots(current: model.carousel.current) { model.carousel.show($0) }
                    }
                    .onGeometryChange(for: CGFloat.self) {
                        $0.frame(in: .named(WelcomeLayout.slidesSpace)).minY
                    } action: {
                        slidesTop = $0
                    }
                    .padding(.vertical, spacing(24))
                    .frame(maxWidth: .infinity, minHeight: pane.size.height)
                    .coordinateSpace(.named(WelcomeLayout.slidesSpace))
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }

        /// A paged carousel the width of the screen, sized by its tallest slide so the account
        /// under it never moves.
        private func phoneCarousel(unit: CGFloat) -> some View {
            ZStack(alignment: .topLeading) {
                ForEach(WelcomeSlide.allCases) { slide in
                    SlidePage(slide: slide, showsPicture: showsPicture, unit: unit).hidden()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay {
                TabView(selection: $model.currentSlide) {
                    ForEach(WelcomeSlide.allCases) { slide in
                        SlidePage(slide: slide, showsPicture: showsPicture, unit: unit)
                            .padding(.horizontal, Self.margin)
                            .frame(maxHeight: .infinity, alignment: .top)
                            .tag(slide)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                // Pages swipe across the whole screen rather than the column's margins.
                .padding(.horizontal, -Self.margin)
            }
        }

        /// The reason, the sign-up buttons, and the two links, on the lockup's leading edge.
        private var account: some View {
            VStack(alignment: .leading, spacing: spacing.stackGap) {
                Text(WelcomeCopy.reason(for: WelcomeDevice.current))
                    .font(.body)
                    .foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if let info {
                    noticeText(info)
                        .font(.subheadline.weight(.semibold))
                }
                VStack(alignment: .leading, spacing: spacing(8)) {
                    if let failure { failureText(failure) }
                    // Every title breaks after "Sign up" once the longest no longer fits on one
                    // line, so the three rows wrap alike and stay equal.
                    ViewThatFits(in: .horizontal) {
                        signUpButtons(stacked: false)
                        signUpButtons(stacked: true)
                    }
                }
                VStack(spacing: spacing.stackGap) {
                    Button(WelcomeCopy.alreadyHaveAccount) { model.signIn() }
                        .buttonStyle(WelcomeLinkStyle(font: .subheadline.weight(.semibold)))
                    Button(WelcomeCopy.whyLink) { model.openReason() }
                        .buttonStyle(WelcomeLinkStyle(font: .footnote))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        private func signUpButtons(stacked: Bool) -> some View {
            VStack(spacing: spacing.stackGap) {
                ForEach(SignUpButton.allCases) { button in
                    Button {
                        start(button)
                    } label: {
                        SignUpButtonLabel(button: button, isRunning: model.signingUp == button, stacked: stacked)
                    }
                    .buttonStyle(SignUpButtonStyle(isRunning: model.signingUp == button, padding: spacing(12)))
                    .disabled(model.signingUp != nil)
                }
            }
        }
    #endif

    private func noticeText(_ text: String) -> some View {
        Text(text)
            .fixedSize(horizontal: false, vertical: true)
            .announced(text)
    }

    private func failureText(_ text: String) -> some View {
        FailureText(text)
            .fixedSize(horizontal: false, vertical: true)
            .announced(text)
    }
}

extension View {
    /// Announces `text` to VoiceOver when it appears or changes. Nothing on the welcome screen
    /// takes first-responder focus, so VoiceOver would not reach a notice on its own the way a
    /// sighted reader does.
    fileprivate func announced(_ text: String) -> some View {
        onChange(of: text, initial: true) { AccessibilityNotification.Announcement(text).post() }
    }
}

/// One slide: its drawing over its headline, announced with its place in the carousel. The
/// drawing gives way at the accessibility text sizes and the headline still pages.
private struct SlidePage: View {
    let slide: WelcomeSlide
    let showsPicture: Bool
    let unit: CGFloat

    @Environment(\.spacing) private var spacing

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsPicture {
                // Every drawing on one stage the slide's width, so the drawings read as a set.
                art(unit: unit * WelcomeLayout.stageContentShare)
                    .frame(maxWidth: .infinity)
                    .frame(height: 17 * unit)
                    .background(Palette.surface, in: .rect(cornerRadius: unit))
                    .padding(.bottom, spacing(20))
            }
            Text(slide.headline(for: WelcomeDevice.current))
                #if os(macOS)
                    .font(MacStyle.columnTitle)
                    .tracking(MacStyle.columnTitleTracking)
                    .foregroundStyle(Palette.textPrimary)
                #else
                    .font(.title2.bold())
                #endif
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        }
        // Without the drawing the stack is only as wide as the headline, which a page would center.
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityValue(WelcomeCopy.slidePosition(slide))
    }

    @ViewBuilder private func art(unit: CGFloat) -> some View {
        switch slide {
        case .intro: WelcomeIllustration(unit: unit)
        case .catalog: CatalogSlideArt(unit: unit)
        case .record: RecordSlideArt(unit: unit)
        case .practice: PracticeSlideArt(unit: unit)
        case .listen: ListenSlideArt(unit: unit)
        case .tuner: TunerSlideArt(unit: unit)
        }
    }
}

/// A dot per slide, each a button that shows its slide. The current one is wider as well as
/// darker, so it never reads by color alone.
private struct CarouselDots: View {
    let current: WelcomeSlide
    let show: (WelcomeSlide) -> Void

    #if os(macOS)
        private static let target: CGFloat = 20
    #else
        private static let target: CGFloat = PageStyle.minTarget
    #endif

    var body: some View {
        HStack(spacing: 0) {
            ForEach(WelcomeSlide.allCases) { slide in
                let isCurrent = slide == current
                Button {
                    show(slide)
                } label: {
                    Capsule()
                        .fill(isCurrent ? Palette.textPrimary : Palette.textSecondary)
                        .frame(width: isCurrent ? 18 : 8, height: 8)
                        .frame(width: Self.target, height: Self.target)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(WelcomeCopy.dotLabel(slide))
                .accessibilityAddTraits(isCurrent ? .isSelected : [])
            }
        }
    }
}

/// A sign-up button's title, behind the provider's mark where it has one, with a spinner
/// after it while that button's flow runs.
private struct SignUpButtonLabel: View {
    let button: SignUpButton
    let isRunning: Bool
    /// Whether the title breaks after "Sign up", as every row's does when the longest does not
    /// fit on one line.
    var stacked = false

    /// Google's "G" at the size its sign-in buttons draw it beside default-size text, scaled with
    /// the title as the Apple symbol is, so the rows stay matched.
    @ScaledMetric(relativeTo: .body) private var assetMarkSize: CGFloat = 20

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            // Every row keeps a mark's slot, email's empty, so the three titles start and wrap
            // alike; each mark sits on its title's first line. The title fills the row, so an
            // overlay past its end would leave the row.
            HStack(alignment: .top, spacing: 8) {
                markSlot
                Text(stacked ? WelcomeLayout.stackedLabel(button.label) : button.label)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isRunning { spinner }
            }
        } else {
            title
                // Past the title's end and out of its layout, so the centered title holds still.
                .overlay(alignment: .trailing) {
                    if isRunning {
                        spinner
                            .frame(width: 0, alignment: .leading)
                            .offset(x: 8)
                    }
                }
        }
    }

    private var spinner: some View {
        ProgressView()
            .controlSize(.small)
            // The row is white in both appearances, so the spinner draws for light.
            .environment(\.colorScheme, .light)
            .fixedSize()
    }

    /// One line of the title tall and a mark wide, the mark centered in it.
    private var markSlot: some View {
        Text(verbatim: " ")
            .hidden()
            .frame(width: assetMarkSize)
            .overlay {
                switch button.mark {
                case .symbol(let symbol):
                    Image(systemName: symbol)
                case .asset(let resource):
                    Image(resource)
                        .resizable()
                        .frame(width: assetMarkSize, height: assetMarkSize)
                case nil:
                    EmptyView()
                }
            }
            .accessibilityHidden(true)
    }

    @ViewBuilder private var title: some View {
        switch button.mark {
        case .symbol(let symbol):
            Label(button.label, systemImage: symbol)
        case .asset(let resource):
            Label {
                Text(button.label)
            } icon: {
                Image(resource)
                    .resizable()
                    .frame(width: assetMarkSize, height: assetMarkSize)
                    .accessibilityHidden(true)
            }
        case nil:
            Text(button.label)
        }
    }
}

/// One of the three sign-up buttons, all alike so no provider leads. Apple allows a Sign in with
/// Apple button only in black, white, or white with an outline, so every row draws white with a
/// black title, outlined in black where the background is light, in pure colors no palette token
/// carries.
private struct SignUpButtonStyle: ButtonStyle {
    /// Whether this row's flow runs, which keeps it at full strength so its spinner reads while
    /// the other rows dim.
    let isRunning: Bool
    #if os(macOS)
        private static let radius = MacButtonStyle.radius
        private static let disabledOpacity = MacButtonStyle.disabledOpacity
    #else
        /// The vertical padding, which scales with the text.
        var padding: CGFloat
        private static let radius: CGFloat = 12
        private static let disabledOpacity = 0.5
    #endif

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            #if os(macOS)
                .macButtonMetrics(.large)
                .frame(maxWidth: .infinity)
            #else
                .font(.body.weight(.semibold))
                .multilineTextAlignment(.center)
                .padding(.vertical, padding)
                .padding(.horizontal)
                .frame(maxWidth: .infinity, minHeight: PageStyle.minTarget)
            #endif
            .foregroundStyle(Color.black)
            .background(Color.white, in: .rect(cornerRadius: Self.radius))
            .overlay {
                if colorScheme == .light {
                    RoundedRectangle(cornerRadius: Self.radius).strokeBorder(Color.black)
                }
            }
            .contentShape(.rect(cornerRadius: Self.radius))
            .opacity(isEnabled || isRunning ? (configuration.isPressed ? 0.6 : 1) : Self.disabledOpacity)
    }
}

#if !os(macOS)
    /// A worded link in the tint with a full touch target.
    private struct WelcomeLinkStyle: ButtonStyle {
        let font: Font

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .font(font)
                .foregroundStyle(.tint)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, minHeight: PageStyle.minTarget, alignment: .leading)
                .contentShape(.rect)
                .opacity(configuration.isPressed ? 0.6 : 1)
        }
    }
#endif

/// Scrolls its content when it runs taller than the space, and otherwise stretches it to the
/// full height, so a spacer inside can push the account to the bottom.
private struct FillingScroll<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                content
                    .frame(minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .pageBackground()
        }
    }
}

#Preview("Welcome") {
    WelcomeView(notice: nil, signUp: .preview)
}

#Preview("Welcome, account deleted") {
    WelcomeView(notice: DeletedNotice.text, signUp: .preview)
}
