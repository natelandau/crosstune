#if os(macOS)
    import SwiftUI

    /// Metrics every Mac form section and row shares.
    enum MacForm {
        /// Space between one section and the next.
        static let sectionGap: CGFloat = 22
        /// Space between a section's heading and its card.
        static let headingGap: CGFloat = 8
        static let cardRadius: CGFloat = 10
        static let rowInset: CGFloat = 12
        /// A row holding a 28pt field with 4pt above and below.
        static let rowMinHeight: CGFloat = 36
        /// The narrowest a row's label runs, so short labels in one card line their controls up.
        static let labelMinWidth: CGFloat = 112
        /// The widest a form's label column grows for a long label; a longer one wraps.
        static let labelMaxWidth: CGFloat = 180

        /// The label column a form's rows share: as wide as its widest one-line label, between
        /// ``labelMinWidth`` and ``labelMaxWidth``, so every value starts at one edge.
        static func labelColumn(_ widths: [CGFloat]) -> CGFloat {
            min(max(widths.max() ?? 0, labelMinWidth), labelMaxWidth).rounded(.up)
        }
    }

    /// Where a form row puts its control. In a form sheet the values lead at one column after
    /// the labels, so fields and pop-ups start on one edge; a Settings or filter card keeps its
    /// controls trailing.
    enum MacFormValues {
        case leading
        case trailing
    }

    extension EnvironmentValues {
        @Entry var macFormValues: MacFormValues = .trailing
        /// The label column every leading row in a form shares, once its labels are measured.
        @Entry var macFormLabelColumn: CGFloat?
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
    /// its line and an optional subtitle in secondary ink under it, then its content, then the
    /// reason the group's last save failed, in red. Help never floats under a card: a group's
    /// goes in the subtitle, a row's in its label's second line.
    ///
    /// As a card, each piece of the content is one row on the surface fill with a hairline between
    /// rows, and a `LabeledContent` or `Toggle` in it lays out as a ``MacFormRow``: label leading,
    /// control trailing. Without the card the content sits straight on the sheet, for a control
    /// that is its own block, such as a segmented control, chips, or a text editor.
    struct MacFormSection<Content: View, Accessory: View>: View {
        private let title: String?
        private let caption: String?
        private let subtitle: String?
        private let failure: String?
        private let card: Bool
        /// A control trailing on the heading line that acts on the whole section, such as Clear.
        private let accessory: Accessory
        private let content: Content

        init(
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

        var body: some View {
            VStack(alignment: .leading, spacing: MacForm.headingGap) {
                if title != nil || caption != nil || subtitle != nil || Accessory.self != EmptyView.self {
                    VStack(alignment: .leading, spacing: 2) {
                        if title != nil || caption != nil || Accessory.self != EmptyView.self { heading }
                        if let subtitle {
                            Text(subtitle)
                                .font(MacStyle.secondary)
                                .foregroundStyle(Palette.inkSecondary)
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
                        .padding(.horizontal, MacForm.rowInset)
                }
            }
        }

        private var heading: some View {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let title {
                    Text(title)
                        .font(MacStyle.sectionHeading)
                        .foregroundStyle(Palette.ink)
                        .accessibilityAddTraits(.isHeader)
                }
                Spacer(minLength: 0)
                if let caption {
                    Text(caption)
                        .font(MacStyle.secondary)
                        .foregroundStyle(Palette.inkSecondary)
                }
                accessory
            }
        }

        private var rows: some View {
            VStack(spacing: 0) {
                Group(subviews: content) { subviews in
                    ForEach(subviews.indices, id: \.self) { index in
                        subviews[index]
                            .frame(maxWidth: .infinity, minHeight: MacForm.rowMinHeight, alignment: .leading)
                            .padding(.horizontal, MacForm.rowInset)
                            .padding(.vertical, 4)
                            .overlay(alignment: .top) {
                                if index > 0 {
                                    Rectangle()
                                        .fill(Palette.hairline)
                                        .frame(height: 1)
                                        .padding(.horizontal, MacForm.rowInset)
                                }
                            }
                    }
                }
            }
            .modifier(MacFormLabelColumnReader())
            .labeledContentStyle(.macFormRow)
            .toggleStyle(.macFormSwitch)
            .background(Palette.surface, in: .rect(cornerRadius: MacForm.cardRadius))
            .macSurfaceContainer()
        }
    }

    extension MacFormSection where Accessory == EmptyView {
        init(
            _ title: String? = nil, caption: String? = nil, subtitle: String? = nil, failure: String? = nil,
            card: Bool = true, @ViewBuilder content: () -> Content
        ) {
            self.init(title, caption: caption, subtitle: subtitle, failure: failure, card: card, content: content) {
                EmptyView()
            }
        }
    }

    /// One row of a Mac form card: the label leading in body ink, with any second line under it in
    /// secondary ink as help, and the control after it. A field fills the room the label leaves.
    /// Where the form's values lead, the label takes the form's shared label column and the
    /// control starts right after it; otherwise the control hugs the trailing edge.
    struct MacFormRow<Label: View, Content: View>: View {
        private let label: Label
        private let content: Content
        private let placement: MacFormValues?

        @Environment(\.macFormValues) private var formValues
        @Environment(\.macFormLabelColumn) private var labelColumn

        /// - Parameter placement: Where the control goes, or nil for where the form puts its values.
        init(
            placement: MacFormValues? = nil, @ViewBuilder content: () -> Content,
            @ViewBuilder label: () -> Label
        ) {
            self.placement = placement
            self.content = content()
            self.label = label()
        }

        private var leads: Bool { (placement ?? formValues) == .leading }

        var body: some View {
            HStack(spacing: 12) {
                Group(subviews: label) { lines in
                    VStack(alignment: .leading, spacing: 2) {
                        if let first = lines.first {
                            first
                                .font(MacStyle.body)
                                .foregroundStyle(Palette.ink)
                                .background {
                                    if leads { labelWidth(first) }
                                }
                        }
                        ForEach(lines.dropFirst()) { line in
                            line
                                .font(MacStyle.secondary)
                                .foregroundStyle(Palette.inkSecondary)
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
        init(_ title: String, @ViewBuilder content: () -> Content) {
            self.init(content: content) { Text(title) }
        }
    }

    /// Lays a `LabeledContent` out as a ``MacFormRow``, so a shared field row such as a
    /// suggestion field or a pop-up takes the card's columns.
    struct MacFormRowStyle: LabeledContentStyle {
        func makeBody(configuration: Configuration) -> some View {
            MacFormRow {
                configuration.content
            } label: {
                configuration.label
            }
        }
    }

    extension LabeledContentStyle where Self == MacFormRowStyle {
        static var macFormRow: Self { MacFormRowStyle() }
    }

    /// A toggle in a form card: its label as a ``MacFormRow`` label, a small switch trailing.
    struct MacFormSwitchStyle: ToggleStyle {
        func makeBody(configuration: Configuration) -> some View {
            MacFormRow(placement: .trailing) {
                Toggle(configuration)
                    .macSwitch(isOn: configuration.isOn)
            } label: {
                configuration.label
            }
        }
    }

    extension ToggleStyle where Self == MacFormSwitchStyle {
        static var macFormSwitch: Self { MacFormSwitchStyle() }
    }

    extension View {
        /// The system switch at the small size, label hidden. Off on a light surface card its
        /// track takes the controls' hairline edge, since the system's pale track nearly matches
        /// the card.
        func macSwitch(isOn: Bool) -> some View {
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
                .switchOnTint()
                .controlSize(.small)
                .labelsHidden()
                .overlay {
                    if !isOn && container.strokesControls(scheme) {
                        Capsule()
                            .strokeBorder(Palette.hairline, lineWidth: 1)
                            .allowsHitTesting(false)
                    }
                }
        }
    }

    /// A long Mac form's scrolling body inside a ``MacSheet`` of fixed size, with the sheet's
    /// margins and the gap between sections. Its values lead at one label column across every
    /// card, so a field and a pop-up start on one edge.
    struct MacFormScroll<Content: View>: View {
        private let content: Content

        init(@ViewBuilder content: () -> Content) {
            self.content = content()
        }

        var body: some View {
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

    /// Multiline text on the field fill with a placeholder where typing starts.
    struct MacTextArea: View {
        /// TextEditor's own padding at each end of a line.
        static let lineFragmentPadding: CGFloat = 5

        private let label: String
        @Binding private var text: String
        private let placeholder: String
        private let minLines: Int
        private let maxLines: Int?

        /// The editor's own size, which its text is measured against.
        @State private var editorSize: CGSize = .zero

        init(_ label: String, text: Binding<String>, placeholder: String, minLines: Int, maxLines: Int? = nil) {
            self.label = label
            _text = text
            self.placeholder = placeholder
            self.minLines = minLines
            self.maxLines = maxLines
        }

        /// Whether `text` needs more room than `height` at `width`. The editor's scroll view never
        /// hides its scroller on its own, so a legacy scroller would show with nothing to scroll.
        static func overflows(_ text: String, width: CGFloat, height: CGFloat) -> Bool {
            // A trailing newline starts a line the measure would not count.
            let measured = text.hasSuffix("\n") ? text + " " : text
            let bounds = NSAttributedString(
                string: measured, attributes: [.font: NSFont.systemFont(ofSize: MacStyle.bodySize)]
            )
            .boundingRect(
                with: CGSize(width: max(width - 2 * lineFragmentPadding, 1), height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading])
            let lines = (bounds.height / MacTextEditorBackground.lineHeight).rounded()
            return lines * MacTextEditorBackground.lineHeight > height + 0.5
        }

        var body: some View {
            TextEditor(text: $text)
                .contentMask()
                .accessibilityLabel(label)
                .scrollIndicators(
                    Self.overflows(text, width: editorSize.width, height: editorSize.height) ? .automatic : .never
                )
                .onGeometryChange(for: CGSize.self, of: \.size) { editorSize = $0 }
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(placeholder)
                            .font(MacStyle.body)
                            .foregroundStyle(Palette.inkSecondary)
                            // TextEditor's own line fragment inset, so the prompt sits where typing starts.
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                // After the placeholder, so the inset moves it with the text.
                .macTextEditor(minLines: minLines, maxLines: maxLines)
        }
    }

    /// A segmented choice drawn in the Mac's own colors: the chosen segment on the accent fill,
    /// the rest in ink on the field fill. Like the system control it is one keyboard stop whose
    /// arrows move the choice, and VoiceOver reads it as the system's segmented picker.
    struct MacSegmentedPicker<Value: Hashable>: View {
        private let title: String
        @Binding private var selection: Value?
        private let options: [(value: Value, label: String)]

        /// A nil `selection` shows no segment chosen, for a value the items disagree on.
        init(_ title: String, selection: Binding<Value?>, options: [(value: Value, label: String)]) {
            self.title = title
            _selection = selection
            self.options = options
        }

        nonisolated static func moved(_ values: [Value], from chosen: Value?, by step: Int) -> Value? {
            MacSegmentTrack<Value>.moved(values, from: chosen, by: step)
        }

        var body: some View {
            MacSegmentTrack(
                title: title, chosen: selection,
                options: options.map { MacSegmentTrack.Option(value: $0.value, label: $0.label) }, look: .accent
            ) { selection = $0 }
        }
    }

    /// A row in a Mac picker sheet: a leading glyph slot, then the row's own content, on the
    /// ground with a field fill under the pointer.
    struct MacPickRowStyle: ButtonStyle {
        static let radius: CGFloat = 7
        static let minHeight: CGFloat = 32

        func makeBody(configuration: Configuration) -> some View {
            MacPickRowBody(configuration: configuration)
        }
    }

    extension ButtonStyle where Self == MacPickRowStyle {
        static var macPickRow: Self { MacPickRowStyle() }
    }

    private struct MacPickRowBody: View {
        let configuration: ButtonStyle.Configuration

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.isFocused) private var isFocused
        @State private var isHovered = false

        var body: some View {
            configuration.label
                .environment(\.macPickRowHighlighted, isEnabled && (isHovered || isFocused))
                .font(MacStyle.body)
                .foregroundStyle(isEnabled ? Palette.ink : Palette.inkSecondary)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, minHeight: MacPickRowStyle.minHeight, alignment: .leading)
                .background(fill, in: .rect(cornerRadius: MacPickRowStyle.radius))
                .contentShape(.rect(cornerRadius: MacPickRowStyle.radius))
                .onHover { isHovered = $0 }
        }

        private var fill: Color {
            guard isEnabled else { return .clear }
            return isHovered || configuration.isPressed ? Palette.field : .clear
        }
    }

    extension EnvironmentValues {
        /// Whether the pick row around a view is under the pointer or holds focus.
        @Entry var macPickRowHighlighted = false
    }

    /// A picker row's leading glyph: + for a choice that adds, an accent check for one already
    /// made, or an empty slot of the same width.
    struct MacPickGlyph: View {
        enum Kind {
            case add
            /// A + that shows only while its row is under the pointer or focused, for a list
            /// where every row adds, so a column of them never stands at rest.
            case addOnHighlight
            case done
            case none
        }

        static let width: CGFloat = 18

        let kind: Kind

        @Environment(\.macPickRowHighlighted) private var highlighted

        nonisolated static func shows(_ kind: Kind, highlighted: Bool) -> Bool {
            kind != .addOnHighlight || highlighted
        }

        var body: some View {
            Group {
                switch kind {
                case .add, .addOnHighlight:
                    Image(systemName: "plus")
                        .foregroundStyle(Palette.inkSecondary)
                        .opacity(Self.shows(kind, highlighted: highlighted) ? 1 : 0)
                case .done:
                    Image(systemName: "checkmark")
                        .foregroundStyle(Palette.accent)
                case .none:
                    Color.clear
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .frame(width: Self.width)
            .accessibilityHidden(true)
        }
    }
#endif
