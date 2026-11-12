import CrosstuneDesign
import CrosstuneStore
import SwiftUI

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
    /// The column's width beside the content, from ``AttributesLayout/columnWidth(forDetailWidth:)``.
    let columnWidth: CGFloat
    /// How far below the scroll view's top edge the column pins as the content scrolls under it.
    let pinnedTop: CGFloat
    /// Opens the list picker; nil leaves out Add to list.
    let onAddToList: (() -> Void)?

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

    static let columnGroups = [AttributeCopy.detailsGroup, AttributeCopy.aboutGroup, AttributeCopy.learnedGroup]

    /// The column's rows, each under its group's heading.
    nonisolated static func columnRows(_ rows: [AttributeRow]) -> [AttributeColumnRow<AttributeID>] {
        let groups = column(rows)
        return groups.details.map { $0.columnRow(group: AttributeCopy.detailsGroup) }
            + groups.about.map { $0.columnRow(group: AttributeCopy.aboutGroup) }
            + groups.learned.map { $0.columnRow(group: AttributeCopy.learnedGroup) }
    }

    static let cardGroups = [AttributeCopy.detailsGroup, AttributeCopy.learnedGroup]

    /// The card's rows and the ones it shows before More details: status, key, tunings, and type
    /// with its parts folded in; the rest of the tune's attributes open in place, and the Learned
    /// group opens under its own heading.
    nonisolated static func cardRows(
        _ rows: [AttributeRow]
    ) -> (rows: [AttributeColumnRow<AttributeID>], beforeMoreDetails: Set<AttributeID>) {
        let split = AttributeRows.card(rows)
        func group(_ row: AttributeRow) -> String {
            row.group == .learned ? AttributeCopy.learnedGroup : AttributeCopy.detailsGroup
        }
        return (
            (split.shown + split.more).map { $0.columnRow(group: group($0)) }, Set(split.shown.map(\.id))
        )
    }

    var body: some View {
        let rows = AttributeRows.rows(detail)
        let card = Self.cardRows(rows)
        AttributesColumn(
            owner: model.tuneID, heading: AttributeCopy.attributesLabel,
            groups: layout == .column ? Self.columnGroups : Self.cardGroups,
            rows: layout == .column ? Self.columnRows(rows) : card.rows, emptyText: AttributeCopy.addValue,
            layout: layout, columnWidth: columnWidth, pinnedTop: pinnedTop, beforeMoreDetails: card.beforeMoreDetails,
            failure: model.failure(at: .attributes)
        ) { row, isPresented, button in
            button
                .attributeEditor(
                    for: row.id, detail: detail, isPresented: isPresented, label: row.label, write: model.write)
        } footer: {
            if !detail.lists.isEmpty || onAddToList != nil {
                AttributesHeading(AttributeCopy.listsGroup, inset: layout.textInset, column: true)
                    .padding(.bottom, 2)
                    .padding(.top, AttributesLayout.columnGroupGap)
                TuneListTokens(model: model, detail: detail, onAddToList: onAddToList)
                    .padding(.horizontal, layout.textInset)
                    .padding(.top, 4)
            }
            AddedOn(detail: detail)
                .padding(.horizontal, layout.textInset)
                .padding(.top, AttributesLayout.columnGroupGap)
        }
        .id(model.tuneID)
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
                    Chip(TuneScreen.addToList, kind: .token, action: onAddToList)
                }
            }
            if let failure = model.failure(at: .lists) {
                FailureText(failure)
            }
        }
    }
}

/// "Date added: <date>", the quiet line that ends the attributes column or the page.
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
