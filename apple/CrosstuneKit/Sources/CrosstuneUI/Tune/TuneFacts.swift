import CrosstuneStore
import SwiftUI

/// Where the tune page's facts stand: a rail beside the content, or a card under the verb row.
enum FactsLayout: Equatable, Sendable {
    case rail
    case card
}

/// Which fact row's editor is open. A key names the tune and the layout too, so a row on another
/// tune, or the same fact drawn in the other layout, never takes the editor.
struct FactsOpenState: Equatable {
    struct Key: Equatable {
        let tuneID: String
        let layout: FactsLayout
        let id: FactID
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

    /// Closes the editor when the facts show another tune or another layout, so a return to
    /// the tune or the layout never reopens it.
    mutating func keep(tuneID: String, layout: FactsLayout) {
        guard let open, open.tuneID != tuneID || open.layout != layout else { return }
        self.open = nil
    }
}

/// The tune's facts, each a row that edits in place. As a rail they stand on the ground behind a
/// hairline in headed groups, label and value in columns, then the lists the tune is in and the
/// day it was added; as a card they show the main facts and open the rest under More details,
/// and the page ends with the lists instead.
///
/// The rows belong to `model`'s tune: a new tune tears them down, so an open editor saves to
/// the tune it was opened for, through that tune's own model.
struct TuneFacts: View {
    let model: TuneModel
    let detail: TuneDetail
    let layout: FactsLayout
    /// How far below the scroll view's top edge the rail pins as the content scrolls under it.
    let pinnedTop: CGFloat
    /// Opens the list picker; nil leaves out Add to list.
    let onAddToList: (() -> Void)?

    @State private var open = FactsOpenState()

    init(
        model: TuneModel, detail: TuneDetail, layout: FactsLayout, pinnedTop: CGFloat = 0,
        onAddToList: (() -> Void)?
    ) {
        self.model = model
        self.detail = detail
        self.layout = layout
        self.pinnedTop = pinnedTop
        self.onAddToList = onAddToList
    }

    /// The rail needs its own width beside a readable content column; narrower, the facts fold
    /// into a card.
    nonisolated static func layout(forDetailWidth width: CGFloat) -> FactsLayout {
        width >= PageStyle.factsRailWidth + PageStyle.contentMinWidth ? .rail : .card
    }

    /// A row's value, or "Add" while the tune holds none.
    nonisolated static func value(_ row: FactRow) -> String {
        row.text ?? FactCopy.addValue
    }

    nonisolated static func accessibilityLabel(_ row: FactRow) -> String {
        "\(row.label), \(value(row))"
    }

    /// The rail's groups: Details, About, then Learned.
    nonisolated static func rail(
        _ rows: [FactRow]
    ) -> (details: [FactRow], about: [FactRow], learned: [FactRow]) {
        let about: Set<FactID> = [.genre, .composer, .alternateTitles]
        let tune = rows.filter { $0.group == .tune }
        return (
            tune.filter { !about.contains($0.id) }, tune.filter { about.contains($0.id) },
            rows.filter { $0.group == .learned }
        )
    }

    /// The card's rows: the main facts, then once More details opens, the rest of the tune's
    /// facts in place and the Learned group under its own heading.
    nonisolated static func card(
        _ rows: [FactRow], expanded: Bool
    ) -> (shown: [FactRow], more: [FactRow], learned: [FactRow]) {
        let split = FactRows.card(rows)
        guard expanded else { return (split.shown, [], []) }
        return (split.shown, split.more.filter { $0.group == .tune }, split.more.filter { $0.group == .learned })
    }

    nonisolated static func moreDetailsState(expanded: Bool) -> String {
        expanded ? FactCopy.expanded : FactCopy.collapsed
    }

    /// How far the rail moves down to stay `top` below the scroll view's edge once its own top,
    /// at `minY`, passes there, stopping where its bottom meets its column's.
    nonisolated static func pinOffset(
        top: CGFloat, minY: CGFloat, columnHeight: CGFloat, railHeight: CGFloat
    ) -> CGFloat {
        min(max(0, top - minY), max(0, columnHeight - railHeight))
    }

    var body: some View {
        let rows = FactRows.rows(detail)
        Group {
            switch layout {
            case .rail:
                rail(rows)
            case .card:
                FactsCard(rows: rows) { row in
                    factRow(row)
                } failure: {
                    failure
                }
            }
        }
        .font(PageStyle.body)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(FactCopy.factsLabel)
        .id(model.tuneID)
        .onChange(of: layout) { open.keep(tuneID: model.tuneID, layout: layout) }
    }

    private var textInset: CGFloat {
        layout == .rail ? Self.railRowMargin + Self.railRowPadding : PageStyle.factsCardInset
    }

    private static let railRowMargin: CGFloat = 8
    private static let railRowPadding: CGFloat = 8
    private static let railGroupGap: CGFloat = 16

    /// The rail's label column: "Time signature" on one line, while a long tuning such as
    /// "5-string banjo tuning" wraps to two.
    #if os(macOS)
        private let railLabelWidth: CGFloat = 88
    #else
        @ScaledMetric(relativeTo: .subheadline) private var railLabelWidth: CGFloat = 108
    #endif

    private func railHeading(_ title: String) -> some View {
        FactsHeading(title, inset: textInset, rail: true)
            .padding(.bottom, 2)
    }

    private func rail(_ rows: [FactRow]) -> some View {
        let groups = Self.rail(rows)
        return VStack(alignment: .leading, spacing: 0) {
            // Centered on the first content heading beside it, as the rail's top aligns there.
            railHeading(FactCopy.detailsGroup)
                .frame(minHeight: PageStyle.headingControlHeight)
            ForEach(groups.details) { row in factRow(row) }
            railHeading(FactCopy.aboutGroup)
                .padding(.top, Self.railGroupGap)
            ForEach(groups.about) { row in factRow(row) }
            railHeading(FactCopy.learnedGroup)
                .padding(.top, Self.railGroupGap)
            ForEach(groups.learned) { row in factRow(row) }
            failure
            if !detail.lists.isEmpty || onAddToList != nil {
                railHeading(FactCopy.listsGroup)
                    .padding(.top, Self.railGroupGap)
                TuneListTokens(model: model, detail: detail, onAddToList: onAddToList)
                    .padding(.horizontal, textInset)
                    .padding(.top, 4)
            }
            AddedOn(detail: detail)
                .padding(.horizontal, textInset)
                .padding(.top, Self.railGroupGap)
        }
        .padding(.bottom, 16)
        .frame(width: PageStyle.factsRailWidth, alignment: .leading)
        .modifier(PinsWhileScrolling(top: pinnedTop))
        .overlay(alignment: .leading) {
            Rectangle().fill(Palette.hairline).frame(width: 1)
        }
    }

    private func factRow(_ row: FactRow) -> some View {
        let isPresented = presented(row)
        return Button {
            isPresented.wrappedValue = true
        } label: {
            if layout == .rail {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.label)
                        .font(PageStyle.secondary)
                        .foregroundStyle(.inkSecondary)
                        .frame(width: railLabelWidth, alignment: .leading)
                    Text(Self.value(row))
                        .contentMask()
                        .foregroundStyle(row.text == nil ? .inkTertiary : AnyShapeStyle(.primary))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
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
        .buttonStyle(FactRowStyle(rail: layout == .rail))
        .accessibilityLabel(Self.accessibilityLabel(row))
        .factEditor(for: row.id, detail: detail, isPresented: isPresented, label: row.label, write: model.write)
    }

    private func label(_ row: FactRow) -> some View {
        Text(row.label)
            .lineLimit(1)
    }

    private func value(_ row: FactRow) -> some View {
        Text(Self.value(row))
            .contentMask()
            .foregroundStyle(row.text == nil ? .inkTertiary : AnyShapeStyle(.primary))
            .lineLimit(1)
    }

    private func presented(_ row: FactRow) -> Binding<Bool> {
        let key = FactsOpenState.Key(tuneID: model.tuneID, layout: layout, id: row.id)
        return Binding {
            open.isPresented(key)
        } set: { shown in
            open.set(key, shown: shown)
        }
    }

    /// Why the last fact write was refused: under the rail's rows, or under the card's first group.
    @ViewBuilder private var failure: some View {
        if let failure = model.failure(at: .facts) {
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

/// "Added <date>", the quiet line that ends the facts rail or the page.
struct AddedOn: View {
    let detail: TuneDetail
    /// Where it ends the page rather than the rail, under a hairline.
    var endsPage = false

    var body: some View {
        VStack(alignment: .leading, spacing: PageStyle.headingGap) {
            if endsPage {
                Rectangle().fill(Palette.hairline).frame(height: 1)
            }
            Text(FactCopy.addedOn(detail.tune.createdAt.date))
                .font(.platform(.caption))
                .foregroundStyle(.inkSecondary)
        }
    }
}

extension View {
    /// Sets `layout` from this view's width, as the detail column the tune page fills. It
    /// changes only as the width crosses the rail's threshold, so a resize redraws nothing
    /// until then.
    func readsFactsLayout(into layout: Binding<FactsLayout>) -> some View {
        onGeometryChange(for: FactsLayout.self) { proxy in
            TuneFacts.layout(forDetailWidth: proxy.size.width)
        } action: { next in
            layout.wrappedValue = next
        }
    }
}

/// The facts as a card: the main rows and More details, which opens the rest in place, then
/// the Learned group as a card of its own.
private struct FactsCard<Row: View, Failure: View>: View {
    let rows: [FactRow]
    @ViewBuilder let row: (FactRow) -> Row
    @ViewBuilder let failure: () -> Failure

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false

    var body: some View {
        let sections = TuneFacts.card(rows, expanded: expanded)
        VStack(alignment: .leading, spacing: 0) {
            FactsGroup {
                ForEach(sections.shown) { fact in row(fact) }
                moreDetails
                ForEach(sections.more) { fact in row(fact) }
            }
            failure()
            if !sections.learned.isEmpty {
                FactsHeading(FactCopy.learnedGroup, inset: PageStyle.factsCardInset)
                    .padding(.top, 16)
                    .padding(.bottom, 6)
                FactsGroup {
                    ForEach(sections.learned) { fact in row(fact) }
                }
            }
        }
    }

    private var moreDetails: some View {
        Button {
            withAnimation(reduceMotion ? nil : .default) { expanded.toggle() }
        } label: {
            HStack(spacing: 12) {
                Text(FactCopy.moreDetails)
                Spacer(minLength: 0)
                Image(systemName: "chevron.down")
                    .font(PageStyle.secondary.weight(.semibold))
                    .foregroundStyle(.inkSecondary)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
        }
        .buttonStyle(FactRowStyle(rail: false))
        .accessibilityValue(TuneFacts.moreDetailsState(expanded: expanded))
    }
}

/// A group's heading in the facts, quiet over its rows: in the rail a small header in tertiary
/// ink, on the card the Learned group's label in secondary ink.
private struct FactsHeading: View {
    let title: String
    let inset: CGFloat
    var rail = false

    init(_ title: String, inset: CGFloat = 0, rail: Bool = false) {
        self.title = title
        self.inset = inset
        self.rail = rail
    }

    var body: some View {
        Text(title)
            .font(rail ? PageStyle.secondary.weight(.medium) : PageStyle.secondary)
            .foregroundStyle(rail ? .inkTertiary : .inkSecondary)
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, inset)
    }
}

/// Rows on one rounded card, a hairline between each and the next.
private struct FactsGroup<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: PageStyle.factsCardRadius)
        Group(subviews: content) { subviews in
            VStack(spacing: 0) {
                ForEach(subviews) { subview in
                    if subview.id != subviews.first?.id {
                        Rectangle()
                            .fill(Palette.hairline)
                            .frame(height: 1)
                            .padding(.leading, PageStyle.factsCardInset)
                    }
                    subview
                }
            }
        }
        .background(Palette.surface, in: shape)
        .clipShape(shape)
    }
}

/// A fact row: label leading, value trailing, and a wash under the pointer or the press. A rail
/// row is inset, so its wash reads as a rounded shape on the open ground; a card row fills the
/// card's width.
private struct FactRowStyle: ButtonStyle {
    let rail: Bool

    func makeBody(configuration: Configuration) -> some View {
        FactRowBody(configuration: configuration, rail: rail)
    }
}

private struct FactRowBody: View {
    let configuration: ButtonStyle.Configuration
    let rail: Bool

    @State private var isHovered = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: rail ? PageStyle.factRowRadius : 0)
        configuration.label
            .padding(.horizontal, rail ? 8 : PageStyle.factsCardInset)
            .frame(maxWidth: .infinity, minHeight: PageStyle.factRowHeight, alignment: .leading)
            .background(isHovered || configuration.isPressed ? Palette.field : .clear, in: shape)
            .contentShape(shape)
            .onHover { isHovered = $0 }
            .padding(.horizontal, rail ? 8 : 0)
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
                .foregroundStyle(.inkSecondary)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(minHeight: PageStyle.smallControlHeight)
                // A resting fill like a list token's, so touch reads it as a control beside them.
                .background(.neutralFill, in: .capsule)
                .overlay {
                    if isHovered || configuration.isPressed { Capsule().fill(Color.primary.opacity(0.06)) }
                }
                .contentShape(.capsule)
                .onHover { isHovered = $0 }
                .tapTarget(visibleHeight: PageStyle.smallControlHeight, minimum: PageStyle.minTarget)
        }
    }
#endif

/// Keeps the rail in view as the content scrolls: once its top would pass `top` below the scroll
/// view's edge it stays there, until its bottom meets the bottom of the column it stands in.
/// The column must be as tall as the content beside it.
///
/// An offset rather than a visual effect, so the rows' hit areas and their editors' popover
/// anchors move with the drawing. The readers sit before the offset, so it never feeds back.
private struct PinsWhileScrolling: ViewModifier {
    let top: CGFloat

    @State private var minY: CGFloat = 0
    @State private var height: CGFloat = 0
    @State private var columnHeight: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGFloat.self, of: { $0.frame(in: .scrollView).minY }) { minY = $0 }
            .onGeometryChange(for: CGFloat.self, of: \.size.height) { height = $0 }
            .offset(
                y: TuneFacts.pinOffset(top: top, minY: minY, columnHeight: columnHeight, railHeight: height)
            )
            .frame(maxHeight: .infinity, alignment: .top)
            .onGeometryChange(for: CGFloat.self, of: \.size.height) { columnHeight = $0 }
    }
}
