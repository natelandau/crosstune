import SwiftUI

/// What a chip holds and how it reads.
package enum ChipKind: Equatable {
    /// One of several values: the accent fill when chosen, the neutral fill at rest.
    case choice(isChosen: Bool)
    /// Opens a menu of values, with a chevron: the tint once a value is set.
    case menu(isSet: Bool)
    /// A set filter that removes itself when pressed, with an x.
    case removable
    /// A value that keeps its own color, or the neutral fill when it has none.
    case token
    /// A state in a tone: its subtle fill under its own color.
    case tone(Palette.Token)
}

/// A Mac look a chip or badge draws in place of its kind's: `.byKind` keeps the kind's, and
/// `.secondaryText` draws plain secondary words on the Mac player dock's badge line.
package enum BadgeLineMacLook: Equatable { case byKind, secondaryText }

/// The iPhone chip: one capsule for a choice, a menu of values, a removable filter, a token, or
/// a tone state. Compact height with a 44pt target, subheadline medium, tabular digits. A chip
/// holds a value; an action is a button. On the Mac it draws the Mac chip, except a token, which
/// draws the Mac's small quiet button, and a tone, which draws the Mac's tone capsule.
package struct Chip<Label: View>: View {
    package typealias Kind = ChipKind

    private let kind: Kind
    private let color: Color?
    private let labelColor: Color?
    private let macLook: BadgeLineMacLook
    private let action: () -> Void
    private let label: Label

    package init(
        _ kind: Kind, color: Color? = nil, labelColor: Color? = nil, macLook: BadgeLineMacLook = .byKind,
        action: @escaping () -> Void, @ViewBuilder label: () -> Label
    ) {
        self.kind = kind
        self.color = color
        self.labelColor = labelColor
        self.macLook = macLook
        self.action = action
        self.label = label()
    }

    package var body: some View {
        #if os(macOS)
            if macLook == .secondaryText {
                Button(action: action) {
                    label
                        .lineLimit(1)
                        .macBadgeLineText()
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
            } else {
                macChip
            }
        #else
            Button(action: action) { label }
                .buttonStyle(ChipButtonStyle(kind: kind, color: color, labelColor: labelColor))
                .accessibilityAddTraits(kind == .choice(isChosen: true) ? .isSelected : [])
        #endif
    }

    #if os(macOS)
        @ViewBuilder private var macChip: some View {
            switch kind {
            case .token:
                Button(action: action) { label }
                    .buttonStyle(MacButtonStyle(.quiet, size: .small))
            case .tone(let token):
                Button(action: action) { MacToneCapsule(token: token) { label } }
                    .buttonStyle(.plain)
            default:
                Button(action: action) {
                    MacChipContent(kind: kind) { label }
                }
                .buttonStyle(MacChipStyle(state: kind.macState, hue: color, hueText: labelColor, size: .standalone))
                .accessibilityAddTraits(kind == .choice(isChosen: true) ? .isSelected : [])
            }
        }
    #endif
}

#if os(macOS)
    extension ChipKind {
        fileprivate var macState: MacChipState {
            switch self {
            case .choice(let isChosen): isChosen ? .chosen : .rest
            case .menu(let isSet): isSet ? .set : .rest
            case .removable: .set
            case .token, .tone: .rest
            }
        }
    }

    /// A state in its tone on the Mac: footnote semibold in the tone's color on its subtle fill.
    private struct MacToneCapsule<Label: View>: View {
        let token: Palette.Token
        @ViewBuilder let label: Label

        @Environment(\.spacing) private var spacing

        var body: some View {
            label
                .font(.platform(.footnote).weight(.semibold))
                .foregroundStyle(Palette.color(token))
                .padding(.horizontal, spacing(10))
                .padding(.vertical, spacing(4))
                .background(Palette.subtle(token), in: .capsule)
                .fixedSize()
        }
    }

    /// A Mac chip's label: the value, then the chevron a menu chip opens with or the x a removable
    /// one takes. A nil `chevronColor` takes the label's color.
    private struct MacChipContent<Label: View>: View {
        let kind: ChipKind
        var chevronColor: Color? = Palette.textSecondary
        @ViewBuilder let label: Label

        var body: some View {
            HStack(spacing: 4) {
                label.lineLimit(1)
                if case .menu = kind {
                    Image(systemName: "chevron.down")
                        .font(PageStyle.pullDownChevron)
                        .foregroundStyle(chevronColor.map(AnyShapeStyle.init) ?? AnyShapeStyle(.foreground))
                        .accessibilityHidden(true)
                }
                if kind == .removable {
                    Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                }
            }
            .fixedSize()
        }
    }
#endif

/// A menu chip that opens a menu of choices rather than acting: the chip's look with its chevron,
/// in the tint once `isSet`. On the Mac it draws the Mac chip, its chevron in `macChevronColor`,
/// or in the label's color when nil.
package struct ChipMenu<Items: View, Label: View>: View {
    private let isSet: Bool
    private let macChevronColor: Color?
    private let items: Items
    private let label: Label

    package init(
        isSet: Bool, macChevronColor: Color? = Palette.textSecondary, @ViewBuilder items: () -> Items,
        @ViewBuilder label: () -> Label
    ) {
        self.isSet = isSet
        self.macChevronColor = macChevronColor
        self.items = items()
        self.label = label()
    }

    package var body: some View {
        let kind = ChipKind.menu(isSet: isSet)
        #if os(macOS)
            Menu {
                items
            } label: {
                MacChipContent(kind: kind, chevronColor: macChevronColor) { label }
            }
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .buttonStyle(MacChipStyle(state: kind.macState, size: .standalone))
            .fixedSize()
        #else
            Menu {
                items
            } label: {
                label
            }
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .buttonStyle(ChipButtonStyle(kind: kind, color: nil, labelColor: nil))
            .fixedSize()
        #endif
    }
}

extension Chip where Label == Text {
    package init(
        _ title: String, kind: Kind, color: Color? = nil, labelColor: Color? = nil, action: @escaping () -> Void
    ) {
        self.init(kind, color: color, labelColor: labelColor, action: action) { Text(title) }
    }
}

/// A chip's look without its button, for a chip inside a `Menu`, a `Button`, or a navigation link
/// of its own, or one that only reports a value. `isCompact` sizes it for a line of row metadata,
/// with no tap target. `systemImage` leads the value in a secondary glyph, as a list token's
/// glyph does. Its text is masked, since a chip's value is often a name the musician gave.
package struct ChipLabel: View {
    package let text: String
    package let kind: ChipKind
    package let color: Color?
    package let labelColor: Color?
    package let isCompact: Bool
    package let systemImage: String?

    package init(
        _ text: String, kind: ChipKind, color: Color? = nil, labelColor: Color? = nil, isCompact: Bool = false,
        systemImage: String? = nil
    ) {
        self.text = text
        self.kind = kind
        self.color = color
        self.labelColor = labelColor
        self.isCompact = isCompact
        self.systemImage = systemImage
    }

    package var body: some View {
        #if os(macOS)
            if case .tone(let token) = kind {
                MacToneCapsule(token: token) { Text(text).contentMask() }
            } else {
                macChip
            }
        #else
            ChipFace(
                kind: kind, color: color, labelColor: labelColor, isCompact: isCompact,
                tabularDigits: systemImage == nil
            ) { content }
        #endif
    }

    #if os(macOS)
        private var macChip: some View {
            // A token's name truncates in a narrow column, as a Mac list token always has.
            content
                .fixedSize(horizontal: systemImage == nil, vertical: systemImage == nil)
                .macChip(
                    state: kind == .choice(isChosen: true) ? .chosen : .rest, hue: color, hueText: labelColor,
                    size: isCompact ? .row : .standalone,
                    minWidth: isCompact ? MacChip.minRowWidth : nil)
        }
    #endif

    @ViewBuilder private var content: some View {
        if let systemImage {
            // A glyph marks a name, not a number to compare, so its digits stay proportional.
            HStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(PageStyle.secondary)
                    .foregroundStyle(.textSecondary)
                Text(text).contentMask()
            }
        } else {
            #if os(macOS)
                Text(text).contentMask().monospacedDigit()
            #else
                Text(text).contentMask()
            #endif
        }
    }
}

#if !os(macOS)
    private struct ChipButtonStyle: ButtonStyle {
        let kind: ChipKind
        let color: Color?
        let labelColor: Color?

        func makeBody(configuration: Configuration) -> some View {
            ChipFace(kind: kind, color: color, labelColor: labelColor, isCompact: false) {
                configuration.label
            }
            .pressDim(configuration.isPressed)
            .libraryHover(.capsule)
        }
    }

    /// A compact chip sits in a line of row metadata and never acts, so it keeps its look when
    /// disabled around it and skips the disabled look's reads and animation.
    private struct ChipFace<Content: View>: View {
        let kind: ChipKind
        let color: Color?
        let labelColor: Color?
        let isCompact: Bool
        var tabularDigits = true
        @ViewBuilder let content: Content

        var body: some View {
            if isCompact {
                face(disabled: false).phoneAnimation(Motion.state, value: kind)
            } else {
                InteractiveChipFace(kind: kind) { disabled in face(disabled: disabled) }
            }
        }

        private func face(disabled: Bool) -> ChipFaceBody<Content> {
            ChipFaceBody(
                kind: kind, color: color, labelColor: labelColor, isCompact: isCompact, disabled: disabled,
                tabularDigits: tabularDigits, content: content)
        }
    }

    private struct InteractiveChipFace<Face: View>: View {
        let kind: ChipKind
        @ViewBuilder let face: (_ disabled: Bool) -> Face

        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let disabled = !isEnabled
            face(disabled)
                .disabledCapsuleRing(disabled)
                .phoneAnimation(Motion.state, value: kind)
                .phoneAnimation(Motion.state, value: disabled)
                .tapTarget()
        }
    }

    private struct ChipFaceBody<Content: View>: View {
        let kind: ChipKind
        let color: Color?
        let labelColor: Color?
        let isCompact: Bool
        let disabled: Bool
        let tabularDigits: Bool
        let content: Content

        @Environment(\.colorScheme) private var colorScheme
        @Environment(\.spacing) private var spacing
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
        @ScaledMetric(relativeTo: .footnote) private var compactHeight: CGFloat = 22

        private var wraps: Bool { dynamicTypeSize.isAccessibilitySize && !isCompact }

        var body: some View {
            HStack(spacing: spacing(6)) {
                // A long value wraps at the accessibility sizes rather than truncating. A compact
                // chip sits in a line of row metadata and stays on one line.
                content
                    .lineLimit(wraps ? nil : 1)
                    .fixedSize(horizontal: kind != .removable || isCompact, vertical: !isCompact)
                if case .menu = kind {
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                }
                if kind == .removable {
                    Image(systemName: "xmark").font(.caption.weight(.semibold))
                }
            }
            .font(isCompact ? .footnote.weight(.medium) : .subheadline.weight(.medium))
            .tabularDigits(tabularDigits)
            .foregroundStyle(disabled ? Palette.onDisabled : text)
            .padding(.horizontal, spacing(isCompact ? 8 : 14))
            .padding(.vertical, isCompact ? 0 : spacing.chipVertical)
            .frame(minHeight: isCompact ? compactHeight : nil)
            .background(disabled ? AnyShapeStyle(.clear) : fill, in: .capsule)
        }

        private var fill: AnyShapeStyle {
            if let color { return AnyShapeStyle(color) }
            switch kind {
            case .choice(let isChosen):
                return isChosen ? AnyShapeStyle(Palette.accentFill) : AnyShapeStyle(.neutralFill)
            case .menu(let isSet): return isSet ? AnyShapeStyle(Palette.tint(colorScheme)) : AnyShapeStyle(.neutralFill)
            case .removable: return AnyShapeStyle(Palette.tint(colorScheme))
            case .token: return AnyShapeStyle(.neutralFill)
            case .tone(let token): return AnyShapeStyle(Palette.subtle(token))
            }
        }

        private var text: Color {
            if let labelColor { return labelColor }
            switch kind {
            case .choice(let isChosen): return isChosen ? Palette.onAccentFill : Palette.textPrimary
            case .menu(let isSet): return isSet ? Palette.onTint(colorScheme) : Palette.textPrimary
            case .removable: return Palette.onTint(colorScheme)
            case .token: return Palette.textPrimary
            case .tone(let token): return Palette.color(token)
            }
        }
    }
    extension View {
        @ViewBuilder fileprivate func tabularDigits(_ isOn: Bool) -> some View {
            if isOn { monospacedDigit() } else { self }
        }
    }
#endif

#Preview("Chips") {
    VStack(alignment: .leading, spacing: 12) {
        HStack {
            Chip("50%", kind: .choice(isChosen: false)) {}
            Chip("75%", kind: .choice(isChosen: true)) {}
            Chip("100%", kind: .choice(isChosen: false)) {}
        }
        HStack {
            Chip("Type", kind: .menu(isSet: false)) {}
            Chip("Reel", kind: .menu(isSet: true)) {}
            Chip("Option", kind: .removable) {}
            Chip("Synced", kind: .tone(.statusKnown)) {}
        }
        Chip("Disabled", kind: .token) {}.disabled(true)
    }
    .padding()
}
