import CrosstuneDesign
import SwiftUI

/// Where a page's attributes sit: a column beside the content, or a card in the content's flow.
enum AttributesLayout: Hashable, Sendable {
    case column
    case card

    /// The column needs its own width beside a readable content column; narrower, the attributes
    /// fold into a card.
    nonisolated static func layout(forDetailWidth width: CGFloat) -> AttributesLayout {
        width >= PageStyle.attributesColumnWidth + PageStyle.attributesColumnGap + PageStyle.contentMinWidth
            ? .column : .card
    }

    /// The column holds the detail column's trailing edge at its narrowest until the content beside
    /// it has the page's readable width, then grows to its widest; past that the content takes
    /// the rest.
    nonisolated static func columnWidth(forDetailWidth width: CGFloat) -> CGFloat {
        let content = PageStyle.pageMaxWidth + 2 * PageStyle.pageMargin
        let spare = width - content - PageStyle.attributesColumnGap
        return min(max(PageStyle.attributesColumnWidth, spare), PageStyle.attributesColumnMaxWidth)
    }

    /// How far a row's text sits from the attributes' leading edge, for content that lines up
    /// with it.
    var textInset: CGFloat {
        self == .column ? Self.columnRowMargin + Self.columnRowPadding : PageStyle.attributesCardInset
    }

    /// The space above each of the column's group headings but the first.
    static let columnGroupGap: CGFloat = 20

    fileprivate static let columnRowMargin: CGFloat = 8
    fileprivate static let columnRowPadding: CGFloat = 8
}

/// How a row in the attributes column sets its label and value: the label over the value while the
/// column is narrow, the value at the trailing edge beside the label once it is wide.
enum AttributeRowArrangement: Equatable, Sendable {
    case stacked
    case beside

    nonisolated static func arrangement(forColumnWidth width: CGFloat) -> AttributeRowArrangement {
        width >= PageStyle.attributesColumnBesideWidth ? .beside : .stacked
    }

    /// An accessibility text size stacks every row, since a label and value side by side would
    /// each wrap to a few words a line.
    nonisolated static func arrangement(
        _ widthArrangement: AttributeRowArrangement, accessibilitySize: Bool
    ) -> AttributeRowArrangement {
        accessibilitySize ? .stacked : widthArrangement
    }
}

/// One row of an attributes column or card.
struct AttributeColumnRow<ID: Hashable>: Hashable, Identifiable {
    let id: ID
    let label: String
    /// Nil when the attribute holds no value, so the row shows the column's empty text.
    let text: String?
    /// The heading of the group the row sits under.
    let group: String
    /// A read-only row shows its value as text, with no editor to open.
    let isReadOnly: Bool

    init(id: ID, label: String, text: String?, group: String, isReadOnly: Bool = false) {
        self.id = id
        self.label = label
        self.text = text
        self.group = group
        self.isReadOnly = isReadOnly
    }

    var control: AttributeRowControl { isReadOnly ? .text : .button }

    /// The row's value, or `emptyText` while the attribute holds none.
    func value(emptyText: String) -> String {
        text ?? emptyText
    }

    func accessibilityLabel(emptyText: String) -> String {
        "\(label), \(value(emptyText: emptyText))"
    }
}

extension AttributeColumnRow: Sendable where ID: Sendable {}

/// What a row draws as: a button that opens its editor, or text.
enum AttributeRowControl: Equatable, Sendable {
    case button
    case text
}

/// What an attributes column draws, in order: each group's heading, then each of its rows
/// followed by the content that goes below that row.
enum AttributeColumnEntry<ID: Hashable>: Hashable, Identifiable {
    case heading(String, isFirst: Bool)
    case row(AttributeColumnRow<ID>)
    case below(ID)

    enum Key: Hashable {
        case heading(String)
        case row(ID)
        case below(ID)
    }

    var id: Key {
        switch self {
        case .heading(let title, _): .heading(title)
        case .row(let row): .row(row.id)
        case .below(let id): .below(id)
        }
    }

    /// The entries for `rows` under `groups`, in the groups' order. A group with no rows is
    /// left out, heading and all.
    static func entries(groups: [String], rows: [AttributeColumnRow<ID>]) -> [Self] {
        var entries: [Self] = []
        for group in groups {
            let members = rows.filter { $0.group == group }
            guard !members.isEmpty else { continue }
            entries.append(.heading(group, isFirst: entries.isEmpty))
            for row in members {
                entries.append(.row(row))
                entries.append(.below(row.id))
            }
        }
        return entries
    }
}

/// One rounded card of the attributes as a card: its rows, and on the first card the rows More
/// details opens in place after its button.
struct AttributeCardSection<ID: Hashable>: Hashable {
    /// The group's heading, nil on the first card, which follows the page's own heading.
    let heading: String?
    let rows: [AttributeColumnRow<ID>]
    /// Whether More details follows ``rows``.
    let hasMoreDetails: Bool
    /// The rows after More details, shown once it opens.
    let more: [AttributeColumnRow<ID>]

    /// The cards for `rows` under `groups`. With `beforeMoreDetails`, the first card shows those
    /// rows, then More details, then the rest of its rows once `expanded`; a later group shows its
    /// rows from that set, the rest once expanded, and no card while it shows none.
    static func sections(
        groups: [String], rows: [AttributeColumnRow<ID>], beforeMoreDetails: Set<ID>?, expanded: Bool
    ) -> [Self] {
        let filled = groups.map { group in (group, rows.filter { $0.group == group }) }.filter { !$0.1.isEmpty }
        let folds = beforeMoreDetails.map { upFront in rows.contains { !upFront.contains($0.id) } } ?? false
        return filled.enumerated().compactMap { index, entry in
            let (group, members) = entry
            let shown = members.filter { beforeMoreDetails?.contains($0.id) ?? true }
            let folded = members.filter { !(beforeMoreDetails?.contains($0.id) ?? true) }
            if index == 0 {
                return Self(heading: nil, rows: shown, hasMoreDetails: folds, more: expanded ? folded : [])
            }
            let visible = expanded ? members : shown
            return visible.isEmpty ? nil : Self(heading: group, rows: visible, hasMoreDetails: false, more: [])
        }
    }
}

/// A page's attributes, each a row that edits in place. As a column they sit on the page
/// background behind a hairline in headed groups, each label over its value or, in a wide column,
/// beside it; as a card each group is a rounded card, later ones under a quiet heading, with
/// More details on the first card opening the rows held back.
///
/// `editor` attaches a row's editor to the button it is handed and must return that button
/// within its result, or the row is not drawn. `below` is the content that follows a row, on the
/// row's own card line, handed the binding that opens the row's editor. `footer` follows the last
/// group, in the column only.
struct AttributesColumn<ID: Hashable, Editor: View, Below: View, Footer: View>: View {
    /// Whose attributes these are, so an editor open for one owner never shows for another.
    let owner: String
    /// The attributes' accessible name.
    let heading: String
    let groups: [String]
    let rows: [AttributeColumnRow<ID>]
    /// What a row with no value reads.
    let emptyText: String
    let layout: AttributesLayout
    /// The column's width beside the content, from ``AttributesLayout/columnWidth(forDetailWidth:)``.
    let columnWidth: CGFloat
    /// How far below the scroll view's top edge the column pins as the content scrolls under it.
    let pinnedTop: CGFloat
    /// On the card, the rows shown before More details; nil shows every row with no More details.
    let beforeMoreDetails: Set<ID>?
    /// Why the last write was refused: under the column's rows, or under the card's first group.
    let failure: String?
    let editor: (AttributeColumnRow<ID>, Binding<Bool>, AttributeRowButton<ID>) -> Editor
    let below: (ID, _ isPresented: Binding<Bool>) -> Below
    let footer: Footer

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var open = AttributesOpenState()
    /// The rows' arrangement for the column's width alone; ``rowArrangement`` also weighs text size.
    @State private var widthArrangement = AttributeRowArrangement.stacked

    init(
        owner: String, heading: String, groups: [String], rows: [AttributeColumnRow<ID>], emptyText: String,
        layout: AttributesLayout, columnWidth: CGFloat = PageStyle.attributesColumnWidth, pinnedTop: CGFloat = 0,
        beforeMoreDetails: Set<ID>? = nil, failure: String? = nil,
        @ViewBuilder editor: @escaping (AttributeColumnRow<ID>, Binding<Bool>, AttributeRowButton<ID>) -> Editor,
        @ViewBuilder below: @escaping (ID, _ isPresented: Binding<Bool>) -> Below,
        @ViewBuilder footer: () -> Footer
    ) {
        self.owner = owner
        self.heading = heading
        self.groups = groups
        self.rows = rows
        self.emptyText = emptyText
        self.layout = layout
        self.columnWidth = columnWidth
        self.pinnedTop = pinnedTop
        self.beforeMoreDetails = beforeMoreDetails
        self.failure = failure
        self.editor = editor
        self.below = below
        self.footer = footer()
    }

    /// The card's rows sit beside their values at every width, so only the text size stacks them.
    private var rowArrangement: AttributeRowArrangement {
        AttributeRowArrangement.arrangement(
            layout == .card ? .beside : widthArrangement, accessibilitySize: dynamicTypeSize.isAccessibilitySize)
    }

    var body: some View {
        Group {
            switch layout {
            case .column:
                AttributesColumnList(
                    entries: AttributeColumnEntry.entries(groups: groups, rows: rows), inset: layout.textInset,
                    columnWidth: columnWidth, pinnedTop: pinnedTop, widthArrangement: $widthArrangement,
                    row: attributeRow, below: { below($0, presented($0)) }, failure: { failureText }, footer: footer)
            case .card:
                AttributesCard(
                    groups: groups, rows: rows, beforeMoreDetails: beforeMoreDetails
                ) { row in
                    VStack(alignment: .leading, spacing: 0) {
                        attributeRow(row)
                        below(row.id, presented(row.id))
                    }
                } failure: {
                    failureText
                }
            }
        }
        .font(PageStyle.body)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(heading)
        .onChange(of: layout) { open.keep(owner: owner, layout: layout) }
        .onChange(of: owner) { open.keep(owner: owner, layout: layout) }
    }

    @ViewBuilder private var failureText: some View {
        if let failure {
            FailureText(failure)
                .padding(.horizontal, layout.textInset)
                .padding(.top, 8)
        }
    }

    @ViewBuilder private func attributeRow(_ row: AttributeColumnRow<ID>) -> some View {
        switch row.control {
        case .text:
            AttributeRowText(row: row, layout: layout, arrangement: rowArrangement, emptyText: emptyText)
        case .button:
            let isPresented = presented(row.id)
            editor(
                row, isPresented,
                AttributeRowButton(row: row, layout: layout, arrangement: rowArrangement, emptyText: emptyText) {
                    isPresented.wrappedValue = true
                })
        }
    }

    private func presented(_ id: ID) -> Binding<Bool> {
        $open[AttributesOpenState.Key(owner: owner, layout: layout, id: id)]
    }
}

extension AttributesColumn where Below == EmptyView {
    init(
        owner: String, heading: String, groups: [String], rows: [AttributeColumnRow<ID>], emptyText: String,
        layout: AttributesLayout, columnWidth: CGFloat = PageStyle.attributesColumnWidth, pinnedTop: CGFloat = 0,
        beforeMoreDetails: Set<ID>? = nil, failure: String? = nil,
        @ViewBuilder editor: @escaping (AttributeColumnRow<ID>, Binding<Bool>, AttributeRowButton<ID>) -> Editor,
        @ViewBuilder footer: () -> Footer
    ) {
        self.init(
            owner: owner, heading: heading, groups: groups, rows: rows, emptyText: emptyText, layout: layout,
            columnWidth: columnWidth, pinnedTop: pinnedTop, beforeMoreDetails: beforeMoreDetails, failure: failure,
            editor: editor, below: { _, _ in EmptyView() },
            footer: footer)
    }
}

/// The attributes as a column: each group's heading over its rows, each row followed by what
/// goes below it, behind a hairline, pinned in view as the content beside it scrolls.
private struct AttributesColumnList<ID: Hashable, Row: View, Below: View, Failure: View, Footer: View>: View {
    let entries: [AttributeColumnEntry<ID>]
    /// How far a row's text sits from the column's leading edge.
    let inset: CGFloat
    let columnWidth: CGFloat
    let pinnedTop: CGFloat
    /// Set from the column's width, for the rows' arrangement.
    @Binding var widthArrangement: AttributeRowArrangement
    @ViewBuilder let row: (AttributeColumnRow<ID>) -> Row
    @ViewBuilder let below: (ID) -> Below
    @ViewBuilder let failure: () -> Failure
    let footer: Footer

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(entries) { entry in
                switch entry {
                case .heading(let title, let isFirst):
                    AttributesHeading(title, inset: inset, column: true)
                        .padding(.bottom, 2)
                        // Centered on the first content heading beside it, as the column's top aligns there.
                        .frame(minHeight: isFirst ? PageStyle.headingControlHeight : nil)
                        .padding(.top, isFirst ? 0 : AttributesLayout.columnGroupGap)
                case .row(let attribute):
                    row(attribute)
                case .below(let id):
                    below(id)
                }
            }
            failure()
            footer
        }
        .padding(.bottom, 24)
        .frame(width: columnWidth, alignment: .leading)
        .onGeometryChange(for: AttributeRowArrangement.self) { proxy in
            AttributeRowArrangement.arrangement(forColumnWidth: proxy.size.width)
        } action: { next in
            widthArrangement = next
        }
        .modifier(PinsWhileScrolling(top: pinnedTop))
        .overlay(alignment: .leading) {
            Rectangle().fill(Palette.border).frame(width: 1)
        }
    }
}

/// The attributes as a card: the first group's rows and More details, which opens the rest in
/// place, then each later group as a card of its own.
private struct AttributesCard<ID: Hashable, Row: View, Failure: View>: View {
    let groups: [String]
    let rows: [AttributeColumnRow<ID>]
    let beforeMoreDetails: Set<ID>?
    @ViewBuilder let row: (AttributeColumnRow<ID>) -> Row
    @ViewBuilder let failure: () -> Failure

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false

    var body: some View {
        let sections = AttributeCardSection.sections(
            groups: groups, rows: rows, beforeMoreDetails: beforeMoreDetails, expanded: expanded)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(sections.enumerated(), id: \.element.heading) { index, section in
                if let heading = section.heading {
                    AttributesHeading(heading, inset: PageStyle.attributesCardInset)
                        .padding(.top, 16)
                        .padding(.bottom, 6)
                }
                AttributesGroup {
                    ForEach(section.rows) { attribute in row(attribute) }
                    if section.hasMoreDetails { moreDetails }
                    ForEach(section.more) { attribute in row(attribute) }
                }
                if index == 0 { failure() }
            }
        }
    }

    private var moreDetails: some View {
        Button {
            withAnimation(reduceMotion ? nil : .default) { expanded.toggle() }
        } label: {
            HStack(spacing: 12) {
                Text(AttributeCopy.moreDetails)
                Spacer(minLength: 0)
                Image(systemName: "chevron.down")
                    .font(PageStyle.secondary.weight(.semibold))
                    .foregroundStyle(.textSecondary)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
        }
        .buttonStyle(AttributeRowStyle(column: false))
        .accessibilityValue(MoreDetailsText.state(expanded: expanded))
    }
}

/// What the card's More details button says about itself.
enum MoreDetailsText {
    static func state(expanded: Bool) -> String {
        expanded ? DisclosureCopy.expanded : DisclosureCopy.collapsed
    }
}

extension View {
    /// Sets `layout` from this view's width, as the detail column the page fills. It changes only
    /// as the width crosses the column's threshold, so a resize redraws nothing until then.
    func readsAttributesLayout(into layout: Binding<AttributesLayout>) -> some View {
        onGeometryChange(for: AttributesLayout.self) { proxy in
            AttributesLayout.layout(forDetailWidth: proxy.size.width)
        } action: { next in
            layout.wrappedValue = next
        }
    }
}

/// A row's button, which opens its editor. Attach the editor to it, so a popover points at the row.
struct AttributeRowButton<ID: Hashable>: View {
    let row: AttributeColumnRow<ID>
    let layout: AttributesLayout
    let arrangement: AttributeRowArrangement
    let emptyText: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            AttributeRowContent(row: row, layout: layout, arrangement: arrangement, emptyText: emptyText)
        }
        .buttonStyle(AttributeRowStyle(column: layout == .column))
        .accessibilityLabel(row.accessibilityLabel(emptyText: emptyText))
    }
}

/// A read-only row: a button's label and frame with no tint and nothing to open.
private struct AttributeRowText<ID: Hashable>: View {
    let row: AttributeColumnRow<ID>
    let layout: AttributesLayout
    let arrangement: AttributeRowArrangement
    let emptyText: String

    var body: some View {
        AttributeRowContent(row: row, layout: layout, arrangement: arrangement, emptyText: emptyText)
            .modifier(AttributeRowFrame(column: layout == .column))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(row.accessibilityLabel(emptyText: emptyText))
    }
}

/// A row's label and value: in the column as ``AttributeColumnRowText`` sets them, on the card
/// the label leading and the value trailing on one line, or the label over the value, each
/// wrapping, when `arrangement` stacks them.
private struct AttributeRowContent<ID: Hashable>: View {
    let row: AttributeColumnRow<ID>
    let layout: AttributesLayout
    let arrangement: AttributeRowArrangement
    let emptyText: String

    var body: some View {
        if layout == .column {
            AttributeColumnRowText(row: row, arrangement: arrangement, emptyText: emptyText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 6)
        } else if arrangement == .stacked {
            VStack(alignment: .leading, spacing: 1) {
                Text(row.label)
                value
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 6)
        } else {
            HStack(spacing: 12) {
                Text(row.label)
                    .lineLimit(1)
                    .layoutPriority(1)
                Spacer(minLength: 0)
                value
                    .lineLimit(1)
            }
        }
    }

    private var value: some View {
        Text(row.value(emptyText: emptyText))
            .contentMask()
            .foregroundStyle(row.text == nil ? .textSecondary : AnyShapeStyle(.textPrimary))
    }
}

/// A group's heading in the attributes: in the column a section heading like the content's beside
/// it, on the card a quiet label in secondary text.
struct AttributesHeading: View {
    let title: String
    let inset: CGFloat
    var column = false

    init(_ title: String, inset: CGFloat = 0, column: Bool = false) {
        self.title = title
        self.inset = inset
        self.column = column
    }

    var body: some View {
        Text(title)
            .font(column ? PageStyle.sectionHeading : PageStyle.secondary)
            .foregroundStyle(column ? .textPrimary : .textSecondary)
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, inset)
    }
}

/// Rows on one rounded card, a hairline between each and the next.
private struct AttributesGroup<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: PageStyle.attributesCardRadius)
        Group(subviews: content) { subviews in
            VStack(spacing: 0) {
                ForEach(subviews) { subview in
                    if subview.id != subviews.first?.id {
                        Rectangle()
                            .fill(Palette.border)
                            .frame(height: 1)
                            .padding(.leading, PageStyle.attributesCardInset)
                    }
                    subview
                }
            }
        }
        .background(Palette.surface, in: shape)
        .clipShape(shape)
    }
}

/// A row's label and value in the attributes column: the label over the value, or the value at the
/// trailing edge beside it. One layout that changes in place, so the rows keep their identity as
/// the column's width crosses the switch.
private struct AttributeColumnRowText<ID: Hashable>: View {
    let row: AttributeColumnRow<ID>
    let arrangement: AttributeRowArrangement
    let emptyText: String

    var body: some View {
        let stacked = arrangement == .stacked
        let layout =
            stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 1))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        layout {
            Text(row.label)
                .font(stacked ? .platform(.caption) : PageStyle.secondary)
                .foregroundStyle(.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(row.value(emptyText: emptyText))
                .contentMask()
                // Medium, matching the web client's attribute values, so a set value reads over its label.
                .fontWeight(row.text == nil ? nil : .medium)
                .monospacedDigit()
                .foregroundStyle(row.text == nil ? .textSecondary : AnyShapeStyle(.textPrimary))
                .multilineTextAlignment(stacked ? .leading : .trailing)
        }
    }
}

/// An attribute row: label leading, value trailing, and a tint under the pointer or the press. A
/// column row is inset, so its tint reads as a rounded shape on the open page background; a card
/// row fills the card's width.
private struct AttributeRowStyle: ButtonStyle {
    let column: Bool

    func makeBody(configuration: Configuration) -> some View {
        AttributeRowBody(configuration: configuration, column: column)
    }
}

private struct AttributeRowBody: View {
    let configuration: ButtonStyle.Configuration
    let column: Bool

    @State private var isHovered = false

    var body: some View {
        configuration.label
            .modifier(
                AttributeRowFrame(
                    column: column, isTinted: isHovered || configuration.isPressed,
                    onHover: {
                        isHovered = $0
                    }))
    }
}

/// A row's insets, height, and the tint it takes under the pointer or the press.
private struct AttributeRowFrame: ViewModifier {
    let column: Bool
    var isTinted = false
    var onHover: ((Bool) -> Void)?

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: column ? PageStyle.attributeRowRadius : 0)
        content
            .padding(.horizontal, column ? AttributesLayout.columnRowPadding : PageStyle.attributesCardInset)
            .frame(maxWidth: .infinity, minHeight: PageStyle.attributeRowHeight, alignment: .leading)
            .background(isTinted ? Palette.field : .clear, in: shape)
            .contentShape(shape)
            .onHover { onHover?($0) }
            .padding(.horizontal, column ? AttributesLayout.columnRowMargin : 0)
    }
}

/// Keeps the column in view as the content scrolls: once its top would pass `top` below the scroll
/// view's edge it stays there, until its bottom meets the bottom of the container it sits in.
/// The container must be as tall as the content beside it.
///
/// An offset rather than a visual effect, so the rows' hit areas and their editors' popover
/// anchors move with the drawing. The readers sit before the offset, so it never feeds back.
struct PinsWhileScrolling: ViewModifier {
    let top: CGFloat

    @State private var minY: CGFloat = 0
    @State private var height: CGFloat = 0
    @State private var containerHeight: CGFloat = 0

    /// How far the column moves down to stay `top` below the scroll view's edge once its own top,
    /// at `minY`, passes there, stopping where its bottom meets its container's.
    nonisolated static func offset(
        top: CGFloat, minY: CGFloat, containerHeight: CGFloat, attributesHeight: CGFloat
    ) -> CGFloat {
        min(max(0, top - minY), max(0, containerHeight - attributesHeight))
    }

    func body(content: Content) -> some View {
        content
            // Held at `top` until the column's top passes there, so scrolling above that writes nothing.
            .onGeometryChange(for: CGFloat.self, of: { min($0.frame(in: .scrollView).minY, top) }) { minY = $0 }
            .onGeometryChange(for: CGFloat.self, of: \.size.height) { height = $0 }
            .offset(
                y: Self.offset(top: top, minY: minY, containerHeight: containerHeight, attributesHeight: height)
            )
            .frame(maxHeight: .infinity, alignment: .top)
            .onGeometryChange(for: CGFloat.self, of: \.size.height) { containerHeight = $0 }
    }
}
