import CrosstuneStore
import Foundation

/// A recording's attributes on its page.
enum RecordingAttributeID: Hashable, Sendable {
    case name
    case tune
    case players
    case recorded
    case location
    case notes
}

/// The rows the Details tab and the attributes column show, in order: the recording's own
/// details, its location, then its notes. Every row opens its editor.
enum RecordingPageRows {
    static let groups = [RecordingPageCopy.detailsGroup, RecordingPageCopy.locationGroup, RecordingPageCopy.notesGroup]

    nonisolated static func rows(
        _ rows: ScreenRows, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> [AttributeColumnRow<RecordingAttributeID>] {
        let recording = rows.recording
        let recorded = recording.knownRecordedDate.map {
            RecordingText.recordedDate($0.at, precision: $0.precision, locale: locale, timeZone: timeZone)
        }
        let details = RecordingPageCopy.detailsGroup
        return [
            AttributeColumnRow(id: .name, label: RecordingPageCopy.name, text: recording.label, group: details),
            AttributeColumnRow(id: .players, label: RecordingPageCopy.players, text: recording.players, group: details),
            AttributeColumnRow(id: .recorded, label: RecordingPageCopy.recorded, text: recorded, group: details),
            AttributeColumnRow(id: .tune, label: RecordingPageCopy.tune, text: rows.tuneTitle, group: details),
            AttributeColumnRow(
                id: .location, label: RecordingPageCopy.location, text: rows.shownPlace,
                group: RecordingPageCopy.locationGroup),
            AttributeColumnRow(
                id: .notes, label: RecordingPageCopy.notes, text: recording.notes, group: RecordingPageCopy.notesGroup),
        ]
    }

    /// The point the Location group's map shows: the recording's own, else its saved
    /// location's. Nil for a recording with no place.
    nonisolated static func mapPoint(_ rows: ScreenRows) -> Coordinate? {
        let recording = rows.recording
        if let lat = recording.placeLat, let lon = recording.placeLon {
            return Coordinate(lat: lat, lon: lon, accuracyM: recording.placeAccuracyM)
        }
        return rows.linkedPlace.map { Coordinate(lat: $0.lat, lon: $0.lon) }
    }

    /// The line under the map: the saved location's address, when the location has a name of
    /// its own that the address does not repeat.
    nonisolated static func placeAddress(_ rows: ScreenRows) -> String? {
        guard let address = rows.linkedPlace?.address, !address.isEmpty, address != rows.shownPlace else {
            return nil
        }
        return address
    }

    /// The page header's second line: the recorded date, else the day it was added, and the
    /// trimmed length.
    nonisolated static func subtitle(
        _ rows: ScreenRows, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> String {
        [
            RecordingText.date(rows.recording, locale: locale, timeZone: timeZone),
            RecordingText.duration(milliseconds: rows.trimmedLengthMs),
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }
}
