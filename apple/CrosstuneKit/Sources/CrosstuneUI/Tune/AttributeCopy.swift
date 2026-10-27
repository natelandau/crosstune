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

    /// "Added to catalog Mar 5, 2024": the day the musician added the tune, in their own time
    /// zone. "to catalog" keeps it from reading as the day the tune joined a list.
    public static func addedOn(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let day = date.formatted(
            Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: timeZone))
        return "Added to catalog \(day)"
    }
}
