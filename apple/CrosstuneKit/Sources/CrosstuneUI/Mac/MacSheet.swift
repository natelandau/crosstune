import CrosstuneDesign

#if os(macOS)
    import SwiftUI

    /// One of a ``MacSheet`` footer's buttons. `MacSheet.Action` names it at a call site.
    struct MacSheetAction {
        let title: String
        let role: MacButtonStyle.Role
        let isEnabled: Bool
        /// Whether Return presses it. Only the primary slot reads this, and a purchase never
        /// answers it.
        let isDefault: Bool
        /// A purchase, which no key and no opening focus may press: a sheet can show unasked.
        let isPurchase: Bool
        let action: @MainActor () -> Void

        init(
            _ title: String, role: MacButtonStyle.Role = .primary, isEnabled: Bool = true, isDefault: Bool = true,
            action: @escaping @MainActor () -> Void
        ) {
            self.init(title, role: role, isEnabled: isEnabled, isDefault: isDefault, isPurchase: false, action: action)
        }

        private init(
            _ title: String, role: MacButtonStyle.Role, isEnabled: Bool, isDefault: Bool, isPurchase: Bool,
            action: @escaping @MainActor () -> Void
        ) {
            self.title = title
            self.role = role
            self.isEnabled = isEnabled
            self.isDefault = isDefault
            self.isPurchase = isPurchase
            self.action = action
        }

        /// Whether Return presses it in the primary slot: never a purchase or a destructive
        /// confirm.
        var answersReturn: Bool { isDefault && !isPurchase && role != .destructiveFilled }

        /// Cancel or Close: a secondary button that Escape presses.
        static func cancel(_ title: String, isEnabled: Bool = true, action: @escaping @MainActor () -> Void) -> Self {
            Self(title, role: .secondary, isEnabled: isEnabled, isDefault: false, action: action)
        }

        /// A purchase: primary, but never the default, so a stray Return in a sheet the musician
        /// did not ask for never starts one.
        static func subscribe(title: String, isEnabled: Bool = true, action: @escaping @MainActor () -> Void) -> Self {
            Self(title, role: .primary, isEnabled: isEnabled, isDefault: false, isPurchase: true, action: action)
        }

        enum KeyRole: Equatable {
            /// Escape.
            case cancellation
            /// Return.
            case defaultAction

            var shortcut: KeyboardShortcut {
                switch self {
                case .cancellation: .cancelAction
                case .defaultAction: .defaultAction
                }
            }
        }

        struct KeyRoles: Equatable {
            var cancel: KeyRole?
            var primary: KeyRole?
        }

        /// The key each footer slot answers: Escape for the cancel slot unless the sheet gives
        /// Escape its own action, and Return for a default primary. The secondary answers none.
        static func keyboardRoles(cancel: Self?, primary: Self?, ownEscape: Bool = false) -> KeyRoles {
            KeyRoles(
                cancel: cancel == nil || ownEscape ? nil : .cancellation,
                primary: primary?.answersReturn == true ? .defaultAction : nil)
        }
    }

    /// The heights of a fitted ``MacSheet``'s title, body content, and footer.
    struct MacSheetFittedParts: Equatable {
        var header: CGFloat = 0
        var body: CGFloat?
        var footer: CGFloat = 0

        /// The whole sheet's height up to `max`, or nil before the body is first laid out.
        func height(max: CGFloat) -> CGFloat? {
            body.map { min(header + $0 + footer, max) }
        }
    }

    /// Where a ``MacSheet`` opens its keyboard focus. No button opens holding focus, so none opens
    /// wearing a ring and Space presses nothing the musician did not reach.
    enum MacSheetOpeningFocus: Hashable {
        /// The first text field, where the system puts focus.
        case firstField
        /// A stop that draws nothing and VoiceOver skips; Tab moves on from it to the first
        /// control.
        case anchor
    }

    /// A ``MacSheet`` footer's buttons and its Escape, worked out apart from the view so each
    /// sheet's keys can be checked.
    struct MacSheetFooter {
        var cancel: MacSheetAction?
        var secondary: MacSheetAction?
        var primary: MacSheetAction?
        /// What Escape does in place of Cancel.
        var escape: (@MainActor () -> Void)?
    }

    /// Every Mac sheet's frame: an in-content title over a body on `pageBackground`, and a
    /// ``MacActionBar`` footer. It draws no toolbar band, so it never sits in a `NavigationStack`
    /// unless the sheet pushes. The call site keeps `.shellSheet()` on its root.
    ///
    /// A ``MacSheetSize/fitted(max:)`` sheet scrolls its body itself and grows to fit it; at any
    /// other size the body fills the frame edge to edge and brings its own scrolling and margins,
    /// such as a picker's list or a long form in ``MacFormScroll``.
    struct MacSheet<Content: View, Leading: View, Accessory: View>: View {
        typealias Action = MacSheetAction

        /// What kind of sheet it is, which sets how its title reads.
        enum Style {
            case sheet
            /// A plan notice: the CT mark over the title.
            case notice
            /// The lyrics or the scans filling the sheet: the musician's own title, masked from
            /// replay, as a page title at the page margin.
            case reading
            /// An irreversible step: the danger glyph leads the title, as an alert's icon does.
            case danger

            var showsMark: Bool { self == .notice }
            var symbol: MacSheetSymbol? { self == .danger ? .danger : nil }
            var masksTitle: Bool { self == .reading }
            var titleStyle: TitleStyle { self == .reading ? .page : .sheet }
        }

        /// How the in-content title reads: a sheet's, or a reading sheet's page title at the
        /// page margin.
        enum TitleStyle {
            case sheet
            case page

            var margin: CGFloat {
                switch self {
                case .sheet: MacStyle.sheetMargin
                case .page: MacStyle.pageMargin
                }
            }

            var size: CGFloat {
                switch self {
                case .sheet: MacStyle.sheetTitleSize
                case .page: MacStyle.pageTitleSize
                }
            }

            /// How far above the title's baseline its capitals' middle sits, where the
            /// accessory's controls center so they read as level with the title.
            var capMiddle: CGFloat {
                NSFont.systemFont(ofSize: size, weight: .bold).capHeight / 2
            }
        }

        let title: String
        let subtitle: String?
        let size: MacSheetSize
        let cancel: Action?
        let secondary: Action?
        let primary: Action?
        /// What Escape does in place of Cancel, such as a notice whose OK closes it, or a picker
        /// that empties its search first.
        let escape: (@MainActor () -> Void)?
        let style: Style
        let leading: Leading
        /// Controls trailing on the title's line, such as a reader's text size or Close.
        let accessory: Accessory
        let content: Content

        /// Where focus starts. A sheet that shows a text field opens in it.
        let openingFocus: MacSheetOpeningFocus
        /// A fitted sheet's parts as last laid out, so its frame holds its whole content.
        @State private var fitted = MacSheetFittedParts()

        fileprivate init(
            title: String, subtitle: String?, size: MacSheetSize, cancel: Action?, secondary: Action?, primary: Action?,
            escape: (@MainActor () -> Void)?, openingFocus: MacSheetOpeningFocus, style: Style, leading: Leading,
            accessory: Accessory, content: Content
        ) {
            self.openingFocus = openingFocus
            self.style = style
            self.title = title
            self.subtitle = subtitle
            self.size = size
            self.cancel = cancel
            self.secondary = secondary
            self.primary = primary
            self.escape = escape
            self.leading = leading
            self.accessory = accessory
            self.content = content
        }

        var body: some View {
            let fittedHeight = size.maxHeight.flatMap(fitted.height(max:))
            MacSheetChrome(
                title: title, subtitle: subtitle, style: style, cancel: cancel, secondary: secondary, primary: primary,
                escape: escape, fitted: size.isFitted ? $fitted : nil, leading: leading, accessory: accessory,
                content: content
            )
            // A fitted sheet's window keeps the height it opened at, so content that arrives
            // later, such as the store's offers, sets both the frame and the window's height, or it
            // would clip top and bottom.
            .frame(height: fittedHeight)
            .background {
                if let fittedHeight {
                    SheetWindowHeight(height: fittedHeight)
                }
            }
            .background(Palette.pageBackground)
            .macOpensUnfocused(openingFocus == .anchor)
            .resetsSurfaceEnvironment()
            .macSheetFrame(size)
        }
    }

    /// A ``MacSheet``'s title, body, footer, and Escape, apart from the window: a host that draws
    /// it elsewhere, such as over part of a page, sets its size, background, and focus.
    struct MacSheetChrome<Content: View, Leading: View, Accessory: View>: View {
        typealias Action = MacSheetAction
        typealias Style = MacSheet<Content, Leading, Accessory>.Style

        static var markHeight: CGFloat { 32 }
        /// Room above the body for a focus ring, which the body's scroll view would clip.
        private static var ringRoom: CGFloat { 4 }

        let title: String
        let subtitle: String?
        let style: Style
        let cancel: Action?
        let secondary: Action?
        let primary: Action?
        /// What Escape does in place of Cancel.
        let escape: (@MainActor () -> Void)?
        /// Where a fitted frame's parts are measured, so its host sizes the frame to them. Nil for
        /// a body that fills the frame edge to edge.
        let fitted: Binding<MacSheetFittedParts>?
        let leading: Leading
        let accessory: Accessory
        let content: Content

        var body: some View {
            VStack(spacing: 0) {
                header
                    .onGeometryChange(for: CGFloat.self, of: \.size.height) { fitted?.wrappedValue.header = $0 }
                bodyArea
                if hasFooter {
                    footer
                        .onGeometryChange(for: CGFloat.self, of: \.size.height) { fitted?.wrappedValue.footer = $0 }
                }
            }
            .background {
                if let escape {
                    Button("", action: escape)
                        .keyboardShortcut(.cancelAction)
                        .hidden()
                        .accessibilityHidden(true)
                }
            }
        }

        private var header: some View {
            VStack(alignment: .leading, spacing: 4) {
                if style.showsMark {
                    Mark()
                        .frame(height: Self.markHeight)
                        .foregroundStyle(Palette.brandSecondary)
                        .accessibilityHidden(true)
                        .padding(.bottom, 12)
                }
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    if let symbol = style.symbol {
                        symbol.image
                            .accessibilityHidden(true)
                    }
                    titleText
                    if Accessory.self != EmptyView.self {
                        Spacer(minLength: 0)
                        let capMiddle = style.titleStyle.capMiddle
                        HStack(spacing: 4) { accessory }
                            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + capMiddle }
                    }
                }
                // A subtitle can name the musician's own content, such as a recording.
                if let subtitle {
                    Text(subtitle)
                        .font(MacStyle.body)
                        .foregroundStyle(Palette.textSecondary)
                        .contentMask()
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], style.titleStyle.margin)
            .padding(.bottom, 12 - Self.ringRoom)
        }

        @ViewBuilder private var titleText: some View {
            if style.masksTitle {
                styledTitle.contentMask()
            } else {
                styledTitle
            }
        }

        @ViewBuilder private var styledTitle: some View {
            switch style.titleStyle {
            case .sheet:
                Text(title)
                    .font(MacStyle.sheetTitle)
                    .foregroundStyle(Palette.textPrimary)
                    .accessibilityAddTraits(.isHeader)
            case .page:
                Text(title)
                    .font(MacStyle.pageTitle)
                    .tracking(MacStyle.pageTitleTracking)
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(2)
                    .accessibilityAddTraits(.isHeader)
            }
        }

        @ViewBuilder private var bodyArea: some View {
            if let fitted {
                ScrollView {
                    content
                        .padding([.horizontal, .bottom], MacStyle.sheetMargin)
                        .padding(.top, Self.ringRoom)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .onGeometryChange(for: CGFloat.self, of: \.size.height) { fitted.wrappedValue.body = $0 }
                }
                .scrollBounceBehavior(.basedOnSize)
            } else {
                // Edge to edge, so the body's own scroll view reaches the sheet's sides and footer.
                content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }

        private var hasFooter: Bool {
            cancel != nil || secondary != nil || primary != nil || Leading.self != EmptyView.self
        }

        private var footer: some View {
            let keys = Action.keyboardRoles(cancel: cancel, primary: primary, ownEscape: escape != nil)
            return MacActionBar(
                cancel: cancel.map { Self.item($0, key: keys.cancel) },
                secondary: secondary.map { Self.item($0, key: nil) },
                primary: primary.map { Self.item($0, key: keys.primary) }
            ) {
                leading
            }
        }

        private static func item(_ action: Action, key: Action.KeyRole?) -> MacActionBar<Leading>.Item {
            .init(
                action.title, role: action.role, isEnabled: action.isEnabled, shortcut: key?.shortcut,
                action: action.action)
        }
    }

    extension MacSheet where Accessory == EmptyView {
        init(
            title: String, subtitle: String? = nil, style: Style = .sheet, size: MacSheetSize, cancel: Action?,
            secondary: Action? = nil, primary: Action?, escape: (@MainActor () -> Void)? = nil,
            openingFocus: MacSheetOpeningFocus = .anchor,
            @ViewBuilder leading: () -> Leading, @ViewBuilder content: () -> Content
        ) {
            self.init(
                title: title, subtitle: subtitle, size: size, cancel: cancel, secondary: secondary, primary: primary,
                escape: escape, openingFocus: openingFocus, style: style, leading: leading(), accessory: EmptyView(),
                content: content())
        }
    }

    extension MacSheet where Leading == EmptyView {
        /// A sheet with `accessory` trailing on its title's line, such as a live state's mark. The
        /// body comes first, so its trailing closures never read as a leading slot's.
        init(
            title: String, subtitle: String? = nil, size: MacSheetSize, cancel: Action?, secondary: Action? = nil,
            primary: Action?, escape: (@MainActor () -> Void)? = nil,
            openingFocus: MacSheetOpeningFocus = .anchor, @ViewBuilder content: () -> Content,
            @ViewBuilder accessory: () -> Accessory
        ) {
            self.init(
                title: title, subtitle: subtitle, size: size, cancel: cancel, secondary: secondary, primary: primary,
                escape: escape, openingFocus: openingFocus, style: .sheet, leading: EmptyView(), accessory: accessory(),
                content: content())
        }

        /// A reading sheet, such as the lyrics or the scans: `title` is user content, drawn as a
        /// page title with `accessory` trailing on its line, over a body that fills the sheet.
        init(
            reading title: String, subtitle: String? = nil, size: MacSheetSize,
            cancel: Action? = nil, primary: Action? = nil, escape: (@MainActor () -> Void)? = nil,
            openingFocus: MacSheetOpeningFocus = .anchor,
            @ViewBuilder accessory: () -> Accessory, @ViewBuilder content: () -> Content
        ) {
            self.init(
                title: title, subtitle: subtitle, size: size, cancel: cancel, secondary: nil, primary: primary,
                escape: escape, openingFocus: openingFocus, style: .reading, leading: EmptyView(),
                accessory: accessory(), content: content())
        }
    }

    extension MacSheet where Leading == EmptyView, Accessory == EmptyView {
        init(
            title: String, subtitle: String? = nil, style: Style = .sheet, size: MacSheetSize, cancel: Action?,
            secondary: Action? = nil, primary: Action?, escape: (@MainActor () -> Void)? = nil,
            openingFocus: MacSheetOpeningFocus = .anchor,
            @ViewBuilder content: () -> Content
        ) {
            self.init(
                title: title, subtitle: subtitle, size: size, cancel: cancel, secondary: secondary, primary: primary,
                escape: escape, openingFocus: openingFocus, style: style, leading: EmptyView(), accessory: EmptyView(),
                content: content())
        }
    }

    /// A glyph that leads a sheet's title.
    enum MacSheetSymbol {
        /// An irreversible step, in the danger red.
        case danger

        var image: some View {
            MacSheetSymbolImage(symbol: self)
        }
    }

    struct MacSheetSymbolImage: View {
        let symbol: MacSheetSymbol

        var body: some View {
            switch symbol {
            case .danger:
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: MacStyle.sheetTitleSize, weight: .semibold))
                    .foregroundStyle(Palette.danger)
            }
        }
    }

    /// Sizes the window it sits in to `height` of content, keeping its width.
    private struct SheetWindowHeight: NSViewRepresentable {
        let height: CGFloat

        func makeNSView(context: Context) -> SheetWindowHeightView { SheetWindowHeightView() }

        func updateNSView(_ view: SheetWindowHeightView, context: Context) {
            view.height = height
        }
    }

    private final class SheetWindowHeightView: NSView {
        var height: CGFloat = 0 {
            didSet { if height != oldValue { resizeWindow() } }
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            resizeWindow()
        }

        private func resizeWindow() {
            guard let window, height > 0 else { return }
            let layout = window.contentLayoutRect.size
            guard abs(layout.height - height) >= 1 else { return }
            // A title bar over a full-size content view is part of the content size but not of the
            // layout area the sheet fills.
            let content = window.contentView?.frame.size ?? layout
            window.setContentSize(CGSize(width: content.width, height: height + content.height - layout.height))
        }
    }
#endif
