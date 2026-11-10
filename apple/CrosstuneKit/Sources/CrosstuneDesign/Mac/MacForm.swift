#if os(macOS)
    import SwiftUI

    /// Metrics every Mac form section and row shares.
    package enum MacForm {
        /// Space between one section and the next.
        package static let sectionGap: CGFloat = 22
        /// Space between a section's heading and its card.
        package static let headingGap: CGFloat = 8
        package static let cardRadius = MacControl.cardRadius
        /// A row's own padding at its sides.
        package static let rowInset: CGFloat = 10
        /// A row's padding above and below its content.
        package static let rowVerticalInset: CGFloat = 4
        package static let rowMinHeight: CGFloat = MacControl.rowMinHeight
        /// Room inside a card around its rows, so a highlighted row sits inside the card's corners.
        package static let cardPadding: CGFloat = 4
        /// How far a row's text sits from its card's edge.
        package static let textInset: CGFloat = cardPadding + rowInset
        /// The padding a card puts around each row.
        package static let rowPadding = EdgeInsets(
            top: rowVerticalInset, leading: rowInset, bottom: rowVerticalInset, trailing: rowInset)
        /// The narrowest a row's label runs, so short labels in one card line their controls up.
        package static let labelMinWidth: CGFloat = 112
        /// The widest a form's label column grows for a long label; a longer one wraps.
        package static let labelMaxWidth: CGFloat = 180

        /// The label column a form's rows share: as wide as its widest one-line label, between
        /// ``labelMinWidth`` and ``labelMaxWidth``, so every value starts at one edge.
        package static func labelColumn(_ widths: [CGFloat]) -> CGFloat {
            min(max(widths.max() ?? 0, labelMinWidth), labelMaxWidth).rounded(.up)
        }
    }

    /// Where a form row puts its control. In a form sheet the values lead at one column after
    /// the labels, so fields and pop-ups start on one edge; a Settings or filter card keeps its
    /// controls trailing.
    package enum MacFormValues {
        case leading
        case trailing
    }

    extension EnvironmentValues {
        @Entry package var macFormValues: MacFormValues = .trailing
        /// The label column every leading row in a form shares, once its labels are measured.
        @Entry package var macFormLabelColumn: CGFloat?
    }

    /// The one-line widths of a form's leading row labels.
    private struct MacFormLabelWidths: PreferenceKey {
        static let defaultValue: [CGFloat] = []

        static func reduce(value: inout [CGFloat], nextValue: () -> [CGFloat]) {
            value += nextValue()
        }
    }

    /// Gathers the widths of the leading row labels under it into one shared label column, unless
    /// a form around it already does.
    private struct MacFormLabelColumnReader: ViewModifier {
        @Environment(\.macFormLabelColumn) private var outer
        @State private var own: CGFloat?

        func body(content: Content) -> some View {
            content
                .environment(\.macFormLabelColumn, outer ?? own)
                .onPreferenceChange(MacFormLabelWidths.self) { widths in
                    own = widths.isEmpty ? nil : MacForm.labelColumn(widths)
                }
        }
    }

    /// A group of a Mac form: a section heading (15 semibold) with an optional caption trailing on
    /// its line and an optional subtitle in secondary text under it, then its content, then the
    /// reason the group's last save failed, in red. Help never floats under a card: a group's
    /// goes in the subtitle, a row's in its label's second line.
    ///
    /// As a card, each piece of the content is one row on the surface fill with a hairline between
    /// rows, and a `LabeledContent` or `Toggle` in it lays out as a ``MacFormRow``: label leading,
    /// control trailing. Without the card the content sits straight on the sheet, for a control
    /// that is its own block, such as a segmented control, chips, or a text editor.
    package struct MacFormSection<Content: View, Accessory: View>: View {
        private let title: String?
        private let caption: String?
        private let subtitle: String?
        private let failure: String?
        private let card: Bool
        /// A control trailing on the heading line that acts on the whole section, such as Clear.
        private let accessory: Accessory
        private let content: Content

        /// The row under the pointer, whose hairlines hide.
        @State private var hoveredRow: Subview.ID?

        package init(
            _ title: String? = nil, caption: String? = nil, subtitle: String? = nil, failure: String? = nil,
            card: Bool = true, @ViewBuilder content: () -> Content, @ViewBuilder accessory: () -> Accessory
        ) {
            self.title = title
            self.caption = caption
            self.subtitle = subtitle
            self.failure = failure
            self.card = card
            self.accessory = accessory()
            self.content = content()
        }

        package var body: some View {
            VStack(alignment: .leading, spacing: MacForm.headingGap) {
                if title != nil || caption != nil || subtitle != nil || Accessory.self != EmptyView.self {
                    VStack(alignment: .leading, spacing: 2) {
                        if title != nil || caption != nil || Accessory.self != EmptyView.self { heading }
                        if let subtitle {
                            Text(subtitle)
                                .font(MacStyle.secondary)
                                .foregroundStyle(Palette.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if card {
                    rows
                } else {
                    content
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let failure {
                    FailureText(failure)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, MacForm.textInset)
                }
            }
        }

        private var heading: some View {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let title {
                    Text(title)
                        .font(MacStyle.sectionHeading)
                        .foregroundStyle(Palette.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                }
                Spacer(minLength: 0)
                if let caption {
                    Text(caption)
                        .font(MacStyle.secondary)
                        .foregroundStyle(Palette.textSecondary)
                }
                accessory
            }
        }

        private var rows: some View {
            VStack(spacing: 0) {
                Group(subviews: content) { subviews in
                    let ids = subviews.map(\.id)
                    let rowAbove = Dictionary(uniqueKeysWithValues: zip(ids.dropFirst(), ids))
                    // Identified by the subview rather than its place, so a row that comes or goes
                    // above leaves the rows below their own state.
                    ForEach(subviews) { row in
                        row
                            .padding(MacForm.rowPadding)
                            .frame(maxWidth: .infinity, minHeight: MacForm.rowMinHeight, alignment: .leading)
                            .onPreferenceChange(MacRowHovered.self) { isHovered in
                                if isHovered {
                                    hoveredRow = row.id
                                } else if hoveredRow == row.id {
                                    hoveredRow = nil
                                }
                            }
                            .overlay(alignment: .top) {
                                if let above = rowAbove[row.id], hoveredRow != row.id, hoveredRow != above {
                                    Rectangle()
                                        .fill(Palette.border)
                                        .frame(height: 1)
                                        .padding(.horizontal, MacForm.rowInset)
                                }
                            }
                    }
                }
            }
            // On the stack, not on each row: a resolved subview never reads an environment value
            // set on it.
            .environment(\.macFormRowPadding, MacForm.rowPadding)
            .padding(MacForm.cardPadding)
            .modifier(MacFormLabelColumnReader())
            .labeledContentStyle(.macFormRow)
            .toggleStyle(.macFormSwitch)
            .background(Palette.surface, in: .rect(cornerRadius: MacForm.cardRadius))
            .macSurfaceContainer()
        }
    }

    extension MacFormSection where Accessory == EmptyView {
        package init(
            _ title: String? = nil, caption: String? = nil, subtitle: String? = nil, failure: String? = nil,
            card: Bool = true, @ViewBuilder content: () -> Content
        ) {
            self.init(title, caption: caption, subtitle: subtitle, failure: failure, card: card, content: content) {
                EmptyView()
            }
        }
    }

    /// One row of a Mac form card: the label leading in the primary text color, with any second
    /// line under it in secondary text as help, and the control after it. A field fills the room
    /// the label leaves. Where the form's values lead, the label takes the form's shared label
    /// column and the control starts right after it; otherwise the control hugs the trailing edge.
    package struct MacFormRow<Label: View, Content: View>: View {
        private let label: Label
        private let content: Content
        private let placement: MacFormValues?

        @Environment(\.macFormValues) private var formValues
        @Environment(\.macFormLabelColumn) private var labelColumn

        /// - Parameter placement: Where the control goes, or nil for where the form puts its values.
        package init(
            placement: MacFormValues? = nil, @ViewBuilder content: () -> Content,
            @ViewBuilder label: () -> Label
        ) {
            self.placement = placement
            self.content = content()
            self.label = label()
        }

        private var leads: Bool { (placement ?? formValues) == .leading }

        package var body: some View {
            HStack(spacing: 12) {
                Group(subviews: label) { lines in
                    VStack(alignment: .leading, spacing: 2) {
                        if let first = lines.first {
                            first
                                .font(MacStyle.body)
                                .foregroundStyle(Palette.textPrimary)
                                .background {
                                    if leads { labelWidth(first) }
                                }
                        }
                        ForEach(lines.dropFirst()) { line in
                            line
                                .font(MacStyle.secondary)
                                .foregroundStyle(Palette.textSecondary)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                // Until the column is measured a label runs to the widest the column may be, so
                // a long one never wraps in the first pass that sizes a fitted sheet.
                .frame(
                    minWidth: leads ? labelColumn ?? MacForm.labelMinWidth : MacForm.labelMinWidth,
                    maxWidth: leads ? labelColumn ?? MacForm.labelMaxWidth : nil, alignment: .leading
                )
                .layoutPriority(1)
                content
                    .frame(maxWidth: .infinity, alignment: leads ? .leading : .trailing)
            }
        }

        /// Reports the label's one-line width, measured on a hidden copy so the shared column it
        /// sets never feeds back into the measure.
        private func labelWidth(_ first: Subview) -> some View {
            first
                .font(MacStyle.body)
                .fixedSize()
                .hidden()
                .overlay {
                    GeometryReader { proxy in
                        Color.clear.preference(key: MacFormLabelWidths.self, value: [proxy.size.width])
                    }
                }
                .frame(width: 0, alignment: .leading)
        }
    }

    extension MacFormRow where Label == Text {
        package init(_ title: String, @ViewBuilder content: () -> Content) {
            self.init(content: content) { Text(title) }
        }
    }

    /// Lays a `LabeledContent` out as a ``MacFormRow``, so a shared field row such as a
    /// suggestion field or a pop-up takes the card's columns.
    package struct MacFormRowStyle: LabeledContentStyle {
        package func makeBody(configuration: Configuration) -> some View {
            MacFormRow {
                configuration.content
            } label: {
                configuration.label
            }
        }
    }

    extension LabeledContentStyle where Self == MacFormRowStyle {
        package static var macFormRow: Self { MacFormRowStyle() }
    }

    /// A toggle in a form card: its label as a ``MacFormRow`` label, a small switch trailing.
    package struct MacFormSwitchStyle: ToggleStyle {
        package func makeBody(configuration: Configuration) -> some View {
            MacFormRow(placement: .trailing) {
                Toggle(configuration)
                    .macSwitch(isOn: configuration.isOn)
            } label: {
                configuration.label
            }
        }
    }

    extension ToggleStyle where Self == MacFormSwitchStyle {
        package static var macFormSwitch: Self { MacFormSwitchStyle() }
    }

    extension View {
        /// The system switch at the small size, label hidden. Off on a light surface card its
        /// track takes the controls' hairline edge, since the system's pale track nearly matches
        /// the card.
        package func macSwitch(isOn: Bool) -> some View {
            modifier(MacSwitch(isOn: isOn))
        }
    }

    private struct MacSwitch: ViewModifier {
        let isOn: Bool

        @Environment(\.macContainer) private var container
        @Environment(\.colorScheme) private var scheme

        func body(content: Content) -> some View {
            content
                .toggleStyle(.switch)
                .accentTrackTint()
                .controlSize(.small)
                .labelsHidden()
                .overlay {
                    if !isOn && container.strokesControls(scheme) {
                        Capsule()
                            .strokeBorder(Palette.border, lineWidth: 1)
                            .allowsHitTesting(false)
                    }
                }
        }
    }

    /// A long Mac form's scrolling body inside a ``MacSheet`` of fixed size, with the sheet's
    /// margins and the gap between sections. Its values lead at one label column across every
    /// card, so a field and a pop-up start on one edge.
    package struct MacFormScroll<Content: View>: View {
        private let content: Content

        package init(@ViewBuilder content: () -> Content) {
            self.content = content()
        }

        package var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, MacStyle.sheetMargin)
                // Room for a focus ring at the top, and air above the footer at the bottom.
                .padding(.top, 4)
                .padding(.bottom, MacStyle.sheetMargin)
                .modifier(MacFormLabelColumnReader())
                .environment(\.macFormValues, .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }
#endif
