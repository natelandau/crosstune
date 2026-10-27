import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// Where the tune page's attributes sit: a column beside the content, or a card under the action
/// button row.
enum AttributesLayout: Equatable, Sendable {
    case column
    case card
}

/// How a row in the attributes column sets its label and value: the label over the value while the
/// column is narrow, the value at the trailing edge beside the label once it is wide.
enum AttributeRowArrangement: Equatable, Sendable {
    case stacked
    case beside
}

/// Which attribute row's editor is open. A key names the tune and the layout too, so a row on
/// another tune, or the same attribute drawn in the other layout, never takes the editor.
struct AttributesOpenState: Equatable {
    struct Key: Equatable {
        let tuneID: String
        let layout: AttributesLayout
        let id: AttributeID
    }

    private var open: Key?

    func isPresented(_ key: Key) -> Bool { open == key }

    /// Opens `key`'s editor, or closes it; closing another row leaves the open one alone.
    mutating func set(_ key: Key, shown: Bool) {
        if shown {
            open = key
        } else if open == key {
            open = nil
        }
    }

    /// Closes the editor when the attributes show another tune or another layout, so a return to
    /// the tune or the layout never reopens it.
    mutating func keep(tuneID: String, layout: AttributesLayout) {
        guard let open, open.tuneID != tuneID || open.layout != layout else { return }
        self.open = nil
    }
}

/// The tune's attributes, each a row that edits in place. As a column they sit on the page background behind a
/// hairline in headed groups, each label over its value or, in a wide column, beside it, then the
/// lists the tune is in and the day it was added; as a card they show the main attributes and open the rest under More details,
/// and the page ends with the lists instead.
///
/// The rows belong to `model`'s tune: a new tune tears them down, so an open editor saves to
/// the tune it was opened for, through that tune's own model.
struct TuneAttributes: View {
    let model: TuneModel
    let detail: TuneDetail
    let layout: AttributesLayout
    /// The column's width beside the content, from ``columnWidth(forDetailWidth:)``.
    let columnWidth: CGFloat
    /// How far below the scroll view's top edge the column pins as the content scrolls under it.
    let pinnedTop: CGFloat
    /// Opens the list picker; nil leaves out Add to list.
    let onAddToList: (() -> Void)?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var open = AttributesOpenState()
    /// The rows' arrangement for the column's width alone; ``rowArrangement`` also weighs text size.
    @State private var widthArrangement = AttributeRowArrangement.stacked

    init(
        model: TuneModel, detail: TuneDetail, layout: AttributesLayout,
        columnWidth: CGFloat = PageStyle.attributesColumnWidth, pinnedTop: CGFloat = 0,
        onAddToList: (() -> Void)?
    ) {
        self.model = model
        self.detail = detail
        self.layout = layout
        self.columnWidth = columnWidth
        self.pinnedTop = pinnedTop
        self.onAddToList = onAddToList
    }

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

    private var rowArrangement: AttributeRowArrangement {
        Self.arrangement(widthArrangement, accessibilitySize: dynamicTypeSize.isAccessibilitySize)
    }

    /// A row's value, or "Add" while the tune holds none.
    nonisolated static func value(_ row: AttributeRow) -> String {
        row.text ?? AttributeCopy.addValue
    }

    nonisolated static func accessibilityLabel(_ row: AttributeRow) -> String {
        "\(row.label), \(value(row))"
    }

    /// The column's groups: Details, About, then Learned.
    nonisolated static func column(
        _ rows: [AttributeRow]
    ) -> (details: [AttributeRow], about: [AttributeRow], learned: [AttributeRow]) {
        let about: Set<AttributeID> = [.genre, .composer, .alternateTitles]
        let tune = rows.filter { $0.group == .tune }
        return (
            tune.filter { !about.contains($0.id) }, tune.filter { about.contains($0.id) },
            rows.filter { $0.group == .learned }
        )
    }

    /// The card's rows: the main attributes, then once More details opens, the rest of the tune's
    /// attributes in place and the Learned group under its own heading.
    nonisolated static func card(
        _ rows: [AttributeRow], expanded: Bool
    ) -> (shown: [AttributeRow], more: [AttributeRow], learned: [AttributeRow]) {
        let split = AttributeRows.card(rows)
        guard expanded else { return (split.shown, [], []) }
        return (split.shown, split.more.filter { $0.group == .tune }, split.more.filter { $0.group == .learned })
    }

    nonisolated static func moreDetailsState(expanded: Bool) -> String {
        expanded ? DisclosureCopy.expanded : DisclosureCopy.collapsed
    }

    /// How far the column moves down to stay `top` below the scroll view's edge once its own top,
    /// at `minY`, passes there, stopping where its bottom meets its container's.
    nonisolated static func pinOffset(
        top: CGFloat, minY: CGFloat, containerHeight: CGFloat, attributesHeight: CGFloat
    ) -> CGFloat {
        min(max(0, top - minY), max(0, containerHeight - attributesHeight))
    }

    var body: some View {
        let rows = AttributeRows.rows(detail)
        Group {
            switch layout {
            case .column:
                column(rows)
            case .card:
                AttributesCard(rows: rows) { row in
                    attributeRow(row)
                } failure: {
                    failure
                }
            }
        }
        .font(PageStyle.body)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(AttributeCopy.attributesLabel)
        .id(model.tuneID)
        .onChange(of: layout) { open.keep(tuneID: model.tuneID, layout: layout) }
    }

    private var textInset: CGFloat {
        layout == .column ? Self.columnRowMargin + Self.columnRowPadding : PageStyle.attributesCardInset
    }

    private static let columnRowMargin: CGFloat = 8
    private static let columnRowPadding: CGFloat = 8
    private static let columnGroupGap: CGFloat = 20

    private func columnHeading(_ title: String) -> some View {
        AttributesHeading(title, inset: textInset, column: true)
            .padding(.bottom, 2)
    }

    private func column(_ rows: [AttributeRow]) -> some View {
        let groups = Self.column(rows)
        return VStack(alignment: .leading, spacing: 0) {
            // Centered on the first content heading beside it, as the column's top aligns there.
            columnHeading(AttributeCopy.detailsGroup)
                .frame(minHeight: PageStyle.headingControlHeight)
            ForEach(groups.details) { row in attributeRow(row) }
            columnHeading(AttributeCopy.aboutGroup)
                .padding(.top, Self.columnGroupGap)
            ForEach(groups.about) { row in attributeRow(row) }
            columnHeading(AttributeCopy.learnedGroup)
                .padding(.top, Self.columnGroupGap)
            ForEach(groups.learned) { row in attributeRow(row) }
            failure
            if !detail.lists.isEmpty || onAddToList != nil {
                columnHeading(AttributeCopy.listsGroup)
                    .padding(.top, Self.columnGroupGap)
                TuneListTokens(model: model, detail: detail, onAddToList: onAddToList)
                    .padding(.horizontal, textInset)
                    .padding(.top, 4)
            }
            AddedOn(detail: detail)
                .padding(.horizontal, textInset)
                .padding(.top, Self.columnGroupGap)
        }
        .padding(.bottom, 24)
        .frame(width: columnWidth, alignment: .leading)
        .onGeometryChange(for: AttributeRowArrangement.self) { proxy in
            Self.arrangement(forColumnWidth: proxy.size.width)
        } action: { next in
            widthArrangement = next
        }
        .modifier(PinsWhileScrolling(top: pinnedTop))
        .overlay(alignment: .leading) {
            Rectangle().fill(Palette.border).frame(width: 1)
        }
    }

    private func attributeRow(_ row: AttributeRow) -> some View {
        let isPresented = presented(row)
        return Button {
            isPresented.wrappedValue = true
        } label: {
            if layout == .column {
                AttributeColumnRow(row: row, arrangement: rowArrangement)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 6)
            } else {
                HStack(spacing: 12) {
                    label(row)
                        .layoutPriority(1)
                    Spacer(minLength: 0)
                    value(row)
                }
            }
        }
        .buttonStyle(AttributeRowStyle(column: layout == .column))
        .accessibilityLabel(Self.accessibilityLabel(row))
        .attributeEditor(for: row.id, detail: detail, isPresented: isPresented, label: row.label, write: model.write)
    }

    private func label(_ row: AttributeRow) -> some View {
        Text(row.label)
            .lineLimit(1)
    }

    private func value(_ row: AttributeRow) -> some View {
        Text(Self.value(row))
            .contentMask()
            .foregroundStyle(row.text == nil ? .textSecondary : AnyShapeStyle(.textPrimary))
            .lineLimit(1)
    }

    private func presented(_ row: AttributeRow) -> Binding<Bool> {
        let key = AttributesOpenState.Key(tuneID: model.tuneID, layout: layout, id: row.id)
        return Binding {
            open.isPresented(key)
        } set: { shown in
            open.set(key, shown: shown)
        }
    }

    /// Why the last attribute write was refused: under the column's rows, or under the card's first
    /// group.
    @ViewBuilder private var failure: some View {
        if let failure = model.failure(at: .attributes) {
            FailureText(failure)
                .padding(.horizontal, textInset)
                .padding(.top, 8)
        }
    }

}

/// The lists the tune is in, as tokens that open them, then Add to list.
struct TuneListTokens: View {
    let model: TuneModel
    let detail: TuneDetail
    /// Opens the list picker; nil leaves out Add to list.
    let onAddToList: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            FlowLayout(spacing: 6, lineSpacing: PageStyle.tokenLineGap(6)) {
                ForEach(detail.lists) { membership in
                    ListToken(model: model, membership: membership)
                }
                if let onAddToList {
                    Button(TuneScreen.addToList, action: onAddToList)
                        .buttonStyle(AddToListStyle())
                }
            }
            if let failure = model.failure(at: .lists) {
                FailureText(failure)
            }
        }
    }
}

/// "Added <date>", the quiet line that ends the attributes column or the page.
struct AddedOn: View {
    let detail: TuneDetail
    /// Where it ends the page rather than the column, under a hairline.
    var endsPage = false

    @Environment(\.locale) private var locale
    @Environment(\.timeZone) private var timeZone

    var body: some View {
        VStack(alignment: .leading, spacing: PageStyle.headingGap) {
            if endsPage {
                Rectangle().fill(Palette.border).frame(height: 1)
            }
            Text(AttributeCopy.addedOn(detail.tune.createdAt.date, locale: locale, timeZone: timeZone))
                .font(.platform(.caption))
                .foregroundStyle(.textSecondary)
        }
    }
}

extension View {
    /// Sets `layout` from this view's width, as the detail column the tune page fills. It
    /// changes only as the width crosses the column's threshold, so a resize redraws nothing
    /// until then.
    func readsAttributesLayout(into layout: Binding<AttributesLayout>) -> some View {
        onGeometryChange(for: AttributesLayout.self) { proxy in
            TuneAttributes.layout(forDetailWidth: proxy.size.width)
        } action: { next in
            layout.wrappedValue = next
        }
    }
}

/// The attributes as a card: the main rows and More details, which opens the rest in place, then
/// the Learned group as a card of its own.
private struct AttributesCard<Row: View, Failure: View>: View {
    let rows: [AttributeRow]
    @ViewBuilder let row: (AttributeRow) -> Row
    @ViewBuilder let failure: () -> Failure

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false

    var body: some View {
        let sections = TuneAttributes.card(rows, expanded: expanded)
        VStack(alignment: .leading, spacing: 0) {
            AttributesGroup {
                ForEach(sections.shown) { attribute in row(attribute) }
                moreDetails
                ForEach(sections.more) { attribute in row(attribute) }
            }
            failure()
            if !sections.learned.isEmpty {
                AttributesHeading(AttributeCopy.learnedGroup, inset: PageStyle.attributesCardInset)
                    .padding(.top, 16)
                    .padding(.bottom, 6)
                AttributesGroup {
                    ForEach(sections.learned) { attribute in row(attribute) }
                }
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
        .accessibilityValue(TuneAttributes.moreDetailsState(expanded: expanded))
    }
}

/// A group's heading in the attributes: in the column a section heading like the content's beside
/// it, on the card the Learned group's quiet label in secondary text.
private struct AttributesHeading: View {
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
private struct AttributeColumnRow: View {
    let row: AttributeRow
    let arrangement: AttributeRowArrangement

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
            Text(TuneAttributes.value(row))
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
        let shape = RoundedRectangle(cornerRadius: column ? PageStyle.attributeRowRadius : 0)
        configuration.label
            .padding(.horizontal, column ? 8 : PageStyle.attributesCardInset)
            .frame(maxWidth: .infinity, minHeight: PageStyle.attributeRowHeight, alignment: .leading)
            .background(isHovered || configuration.isPressed ? Palette.field : .clear, in: shape)
            .contentShape(shape)
            .onHover { isHovered = $0 }
            .padding(.horizontal, column ? 8 : 0)
    }
}

/// The lists group's Add to list: quiet words beside the list tokens, at their height, on a
/// token's fill on touch.
private struct AddToListStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        #if os(macOS)
            MacButtonStyle(.quiet, size: .small).makeBody(configuration: configuration)
        #else
            AddToListBody(configuration: configuration)
        #endif
    }
}

#if !os(macOS)
    private struct AddToListBody: View {
        let configuration: ButtonStyle.Configuration

        @State private var isHovered = false

        var body: some View {
            configuration.label
                .font(PageStyle.secondary)
                .foregroundStyle(.textSecondary)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(minHeight: PageStyle.smallControlHeight)
                // A resting fill like a list token's, so touch reads it as a control beside them.
                .background(.neutralFill, in: .capsule)
                .overlay {
                    if isHovered || configuration.isPressed { Capsule().fill(Palette.hoverOverlay) }
                }
                .contentShape(.capsule)
                .onHover { isHovered = $0 }
                .tapTarget(visibleHeight: PageStyle.smallControlHeight, minimum: PageStyle.minTarget)
        }
    }
#endif

/// Keeps the column in view as the content scrolls: once its top would pass `top` below the scroll
/// view's edge it stays there, until its bottom meets the bottom of the container it sits in.
/// The container must be as tall as the content beside it.
///
/// An offset rather than a visual effect, so the rows' hit areas and their editors' popover
/// anchors move with the drawing. The readers sit before the offset, so it never feeds back.
private struct PinsWhileScrolling: ViewModifier {
    let top: CGFloat

    @State private var minY: CGFloat = 0
    @State private var height: CGFloat = 0
    @State private var containerHeight: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGFloat.self, of: { $0.frame(in: .scrollView).minY }) { minY = $0 }
            .onGeometryChange(for: CGFloat.self, of: \.size.height) { height = $0 }
            .offset(
                y: TuneAttributes.pinOffset(
                    top: top, minY: minY, containerHeight: containerHeight, attributesHeight: height)
            )
            .frame(maxHeight: .infinity, alignment: .top)
            .onGeometryChange(for: CGFloat.self, of: \.size.height) { containerHeight = $0 }
    }
}
