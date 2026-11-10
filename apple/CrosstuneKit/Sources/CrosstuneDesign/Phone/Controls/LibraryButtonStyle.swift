import SwiftUI

/// The iPhone button styles: a filled accent capsule, a tinted capsule, and words alone. The
/// size follows `controlSize`: small is Compact, regular is Regular, large is a full-width
/// Large button. The text style ignores the size and, at the accessibility sizes, wraps its words
/// rather than truncate them, as the Large button does; a one-word label takes `oneLine`. On the
/// Mac each draws the Mac button it stands for at the control size: Filled, Tinted, or Text, and
/// a destructive tinted button draws the Mac's destructive one.
package struct LibraryButtonStyle: PrimitiveButtonStyle {
    package enum Kind { case filled, tinted, text }

    package let kind: Kind
    /// Keeps iPhone and iPad words on one line at every size. A Mac button never wraps.
    package let oneLine: Bool

    package init(_ kind: Kind, oneLine: Bool = false) {
        self.kind = kind
        self.oneLine = oneLine
    }

    package func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
            MacLibraryButton(kind: kind, configuration: configuration)
        #else
            Button(configuration)
                .buttonStyle(LibraryButtonAppearance(kind: kind, oneLine: oneLine))
        #endif
    }
}

#if os(macOS)
    private struct MacLibraryButton: View {
        let kind: LibraryButtonStyle.Kind
        let configuration: PrimitiveButtonStyleConfiguration

        @Environment(\.controlSize) private var controlSize

        var body: some View {
            Button(configuration)
                .buttonStyle(MacButtonStyle(role, size: MacButtonStyle.Size(controlSize)))
        }

        private var role: MacButtonStyle.Role {
            switch kind {
            case .filled: .primary
            case .tinted: configuration.role == .destructive ? .destructive : MacButtonStyle.Role.secondary
            case .text: .plain
            }
        }
    }
#endif

extension PrimitiveButtonStyle where Self == LibraryButtonStyle {
    /// The accent-filled capsule.
    package static var filled: Self { LibraryButtonStyle(.filled) }
    /// The tinted capsule.
    package static var tinted: Self { LibraryButtonStyle(.tinted) }
    /// Words in the accent, with no capsule at rest.
    package static var text: Self { LibraryButtonStyle(.text) }
    /// Words in the accent, with no capsule at rest, on one line at every size when `oneLine`.
    package static func text(oneLine: Bool) -> Self {
        LibraryButtonStyle(.text, oneLine: oneLine)
    }
}

extension View {
    /// A form row's button that sets or clears the row's value, such as Not set or Clear date.
    /// On iPhone and iPad it is a borderless line in secondary text, a glyph alone where its
    /// label has one; on the Mac it is a Text button in words.
    package func formValueButtonStyle() -> some View {
        #if os(macOS)
            labelStyle(.titleOnly).buttonStyle(.text)
        #else
            labelStyle(.iconOnly).buttonStyle(.rowLine).foregroundStyle(.textSecondary)
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
    /// Gives a menu the text button's look as a button menu, and the buttons beside it too. A menu
    /// takes its look only from a plain button style, never from `.text`, which is a primitive
    /// one. On the Mac it draws the Mac's Text button at the control size.
    package func textButtonMenuAppearance() -> some View {
        #if os(macOS)
            macMenuAppearance(.plain)
        #else
            menuStyle(.button).buttonStyle(LibraryButtonAppearance(kind: .text, oneLine: false))
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
