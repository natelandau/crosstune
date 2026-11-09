import SwiftUI

/// The iPhone button styles: a filled accent capsule, a tinted capsule, and words alone. The
/// size follows `controlSize`: small is Compact, regular is Regular, large is a full-width
/// Large button. The text style ignores the size and, at the accessibility sizes, wraps its words
/// rather than truncate them, as the Large button does; a one-word label takes `oneLine`. On the Mac each draws the Mac
/// button it stands for, and a destructive tinted button draws the Mac's destructive one, unless
/// `macLook` names another.
package struct LibraryButtonStyle: PrimitiveButtonStyle {
    package enum Kind { case filled, tinted, text }
    /// The Mac look drawn: `.byKind`, the Mac button the kind stands for; `.button`, the Mac
    /// button of another role and size; `.accentLabel`, the label alone in the accent, as a plain
    /// button draws it, taking presses 12 pt past its words; `.accentWords`, plain semibold words in the accent in a full-height target,
    /// as a breakdown's Show all draws them; `.bordered`, the system's bordered button, as the
    /// player's Retry draws it; or `.system`, the system's own button.
    package enum MacLook: Equatable {
        case byKind
        case button(MacRole, size: MacSize = .regular)
        case accentLabel
        case accentWords
        case bordered
        case system
    }

    /// The roles of the Mac's content buttons a Mac look can name.
    package enum MacRole: Equatable { case secondary, plain, quiet, icon }
    package enum MacSize: Equatable { case small, regular, large }

    package let kind: Kind
    package let macLook: MacLook
    /// Keeps iPhone and iPad words on one line at every size. A Mac button never wraps.
    package let oneLine: Bool

    package init(_ kind: Kind, macLook: MacLook = .byKind, oneLine: Bool = false) {
        self.kind = kind
        self.macLook = macLook
        self.oneLine = oneLine
    }

    package func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
            switch macLook {
            case .byKind:
                Button(configuration)
                    .buttonStyle(macStyle(destructive: configuration.role == .destructive))
            case .button(let role, let size):
                Button(configuration)
                    .buttonStyle(MacButtonStyle(role.macRole, size: size.macSize))
            case .accentLabel:
                // A plain Mac button takes presses only on its label.
                Button(role: configuration.role, action: configuration.trigger) {
                    configuration.label.hitOutset(.all, by: 12)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.accent)
            case .accentWords:
                Button(configuration)
                    .font(PageStyle.secondary.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.accent)
                    .padding(.horizontal, 8)
                    .frame(minHeight: PageStyle.minTarget, alignment: .leading)
                    .contentShape(.rect)
            case .bordered:
                Button(configuration)
                    .buttonStyle(.bordered)
            case .system:
                Button(configuration)
                    .buttonStyle(.automatic)
            }
        #else
            Button(configuration)
                .buttonStyle(LibraryButtonAppearance(kind: kind, oneLine: oneLine))
        #endif
    }

    #if os(macOS)
        private func macStyle(destructive: Bool) -> MacButtonStyle {
            switch kind {
            case .filled: MacButtonStyle(.primary)
            case .tinted: destructive ? MacButtonStyle(.destructive) : MacButtonStyle(.secondary)
            case .text: MacButtonStyle(.icon, size: .small)
            }
        }
    #endif
}

#if os(macOS)
    extension LibraryButtonStyle.MacRole {
        fileprivate var macRole: MacButtonStyle.Role {
            switch self {
            case .secondary: MacButtonStyle.Role.secondary
            case .plain: MacButtonStyle.Role.plain
            case .quiet: MacButtonStyle.Role.quiet
            case .icon: MacButtonStyle.Role.icon
            }
        }
    }

    extension LibraryButtonStyle.MacSize {
        fileprivate var macSize: MacButtonStyle.Size {
            switch self {
            case .small: .small
            case .regular: .regular
            case .large: .large
            }
        }
    }
#endif

extension PrimitiveButtonStyle where Self == LibraryButtonStyle {
    /// The accent-filled capsule.
    package static var filled: Self { LibraryButtonStyle(.filled) }
    /// The tinted capsule.
    package static var tinted: Self { LibraryButtonStyle(.tinted) }
    /// The tinted capsule, and on the Mac the look `macLook` names.
    package static func tinted(macLook: LibraryButtonStyle.MacLook) -> Self {
        LibraryButtonStyle(.tinted, macLook: macLook)
    }
    /// Words in the accent, with no capsule at rest.
    package static var text: Self { LibraryButtonStyle(.text) }
    /// Words in the accent, with no capsule at rest, on one line at every size when `oneLine`,
    /// and on the Mac the look `macLook` names.
    package static func text(macLook: LibraryButtonStyle.MacLook = .byKind, oneLine: Bool = false) -> Self {
        LibraryButtonStyle(.text, macLook: macLook, oneLine: oneLine)
    }
}

extension View {
    /// Draws a `Link` as the text button. The Mac keeps the system link.
    package func textLinkStyle() -> some View {
        #if os(macOS)
            self
        #else
            buttonStyle(.text)
        #endif
    }
}

extension EnvironmentValues {
    /// Spans the button's capsule across the width it is offered at any size, for a button that
    /// takes an equal share of a row.
    @Entry package var libraryButtonFillsWidth = false
}

#if !os(macOS)
    private struct LibraryButtonAppearance: ButtonStyle {
        let kind: LibraryButtonStyle.Kind
        let oneLine: Bool

        @ViewBuilder func makeBody(configuration: Configuration) -> some View {
            if oneLine {
                LibraryButtonBody(kind: kind, configuration: configuration).fixedSize()
            } else {
                LibraryButtonBody(kind: kind, configuration: configuration)
            }
        }
    }

    private struct LibraryButtonBody: View {
        let kind: LibraryButtonStyle.Kind
        let configuration: ButtonStyleConfiguration

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.colorScheme) private var colorScheme
        @Environment(\.controlSize) private var controlSize
        @Environment(\.tightActionButtonLabels) private var tight
        @Environment(\.libraryButtonFillsWidth) private var fillsRowWidth
        @Environment(\.spacing) private var spacing
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
        @Environment(\.multilineTextAlignment) private var inheritedAlignment
        @ScaledMetric(relativeTo: .subheadline) private var compactHeight = ControlMetrics.compactHeight
        @ScaledMetric(relativeTo: .subheadline) private var regularHeight = ControlMetrics.regularHeight
        @ScaledMetric(relativeTo: .body) private var largeHeight = ControlMetrics.largeHeight

        private var size: ButtonSize {
            guard kind != .text else { return .text }
            return switch controlSize {
            case .mini, .small: .compact
            case .large, .extraLarge: .large
            default: .regular
            }
        }

        /// A small text button reads a step below the regular one, for a secondary link.
        private var font: Font {
            if size == .large { return .body.weight(.semibold) }
            if kind == .text, controlSize == .small || controlSize == .mini {
                return .footnote.weight(.semibold)
            }
            return .subheadline.weight(.semibold)
        }

        private var destructive: Bool { configuration.role == .destructive }
        private var height: CGFloat {
            switch size {
            case .compact, .text: compactHeight
            case .regular: regularHeight
            case .large: largeHeight
            }
        }
        private var fillsWidth: Bool { size == .large || fillsRowWidth }
        /// Words and the full-width Large capsule wrap at the accessibility sizes rather than
        /// truncate, so a sheet's decision always reads in full. A smaller capsule keeps one line.
        private var wraps: Bool { (kind == .text || size == .large) && dynamicTypeSize.isAccessibilitySize }

        var body: some View {
            configuration.label
                .font(font)
                .foregroundStyle(label)
                .modifier(OneLine(isOn: !wraps))
                .multilineTextAlignment(size == .large ? .center : inheritedAlignment)
                .padding(.horizontal, sideInset)
                .frame(
                    minWidth: fillsWidth ? nil : ControlMetrics.minWidth(size),
                    maxWidth: fillsWidth ? .infinity : nil,
                    minHeight: height
                )
                .background(fill, in: .capsule)
                .disabledCapsuleRing(!isEnabled && kind != .text)
                .pressDim(configuration.isPressed)
                .libraryHover(.capsule)
                .tapTarget(visibleHeight: height)
        }

        private var sideInset: CGFloat {
            switch kind {
            case .text: spacing(ControlMetrics.textButtonInset)
            default: spacing(tight ? 6 : 14)
            }
        }

        private var fill: Color {
            guard isEnabled else { return .clear }
            switch kind {
            case .filled: return Palette.accentFill
            case .tinted: return destructive ? Palette.field : Palette.tint(colorScheme)
            case .text: return .clear
            }
        }

        private var label: Color {
            guard isEnabled else { return Palette.onDisabled }
            switch kind {
            case .filled: return Palette.onAccentFill
            case .tinted: return destructive ? Palette.danger : Palette.onTint(colorScheme)
            case .text: return destructive ? Palette.danger : Palette.accent
            }
        }
    }
#endif

extension View {
    /// Draws a text-style button's words at the leading edge of its container, cancelling the
    /// side inset the style adds. The Mac style adds none.
    package func textButtonAlignedToLeadingEdge() -> some View {
        modifier(TextButtonLeadingAlignment())
    }
}

extension View {
    /// Gives a menu the text button's look, and the buttons beside it too. A menu takes its look
    /// only from a plain button style, never from `.text`, which is a primitive one. On the Mac it
    /// draws the Mac button of `macRole` and `macSize`, by default the one `.text` draws.
    package func textButtonMenuAppearance(
        macRole: LibraryButtonStyle.MacRole = .icon, macSize: LibraryButtonStyle.MacSize = .small
    ) -> some View {
        #if os(macOS)
            buttonStyle(MacButtonStyle(macRole.macRole, size: macSize.macSize))
        #else
            buttonStyle(LibraryButtonAppearance(kind: .text, oneLine: false))
        #endif
    }
}

private struct TextButtonLeadingAlignment: ViewModifier {
    #if os(macOS)
        func body(content: Content) -> some View { content }
    #else
        @Environment(\.spacing) private var spacing

        func body(content: Content) -> some View {
            content.padding(.leading, -spacing(ControlMetrics.textButtonInset))
        }
    #endif
}

#if !os(macOS)
    /// One line, or no limit of its own, so a caller's `lineLimit` still holds while words wrap.
    private struct OneLine: ViewModifier {
        let isOn: Bool

        func body(content: Content) -> some View {
            if isOn { content.lineLimit(1) } else { content }
        }
    }
#endif

#Preview("Buttons") {
    VStack(spacing: 12) {
        HStack {
            Button("Play") {}.buttonStyle(.filled)
            Button("Share") {}.buttonStyle(.tinted)
            Button("Edit") {}.buttonStyle(.text)
        }
        HStack {
            Button("Add") {}.buttonStyle(.filled).controlSize(.small)
            Button("Delete", role: .destructive) {}.buttonStyle(.tinted)
            Button("Save") {}.buttonStyle(.filled).disabled(true)
        }
        Button("Continue") {}.buttonStyle(.filled).controlSize(.large)
    }
    .padding()
}
