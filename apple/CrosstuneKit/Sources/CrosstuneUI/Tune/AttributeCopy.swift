import Foundation

/// The words the tune page's attributes column and card share.
public enum AttributeCopy {
    public static let addValue = "Add"
    public static let moreDetails = "More details"
    /// The attributes column's groups, in order, Lists last.
    public static let detailsGroup = "Details"
    public static let aboutGroup = "About"
    public static let learnedGroup = "Learned"
    /// The attribute editor sheet's close, which saves the draft.
    public static let done = "Done"
    public static let listsGroup = "Lists"
    /// The attributes' accessible name, as a column or a card.
    public static let attributesLabel = "Tune details"

    /// "Date added: Mar 5, 2024": the day the musician added a tune or a recording, in their own
    /// time zone.
    public static func addedOn(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let day = date.formatted(
            Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: timeZone))
        return "Date added: \(day)"
    }
}
