import CrosstuneStore
import CrosstuneVocabulary
import Foundation

// A port of web/src/features/stats. Both clients must return the same `Stats` for every case in
// fixtures/stats, so each rule and tie-break here mirrors the web module.

private let minVisibleDays = 7
private let maxOnThisDay = 3
private let heatmapWeeks = 52
// Under a minute recorded, no comparison reads as more than a joke.
private let minEquivalenceMs = 60_000

/// Everything the stats page shows, from the rows on the device.
public func computeStats(_ input: StatsInput) -> Stats {
    let zone = TimeZone(identifier: input.timeZone) ?? .gmt
    let entries = catalogEntries(input)
    let current = entries.filter { !isSet($0.userTune.archivedAt) }
    let recordings = input.recordings.filter { !isSet($0.deletedAt) }
    let totalMs = recordings.reduce(0) { $0 + trimmedLength($1) }
    return Stats(
        counts: counts(input, entries: entries, current: current),
        recorded: Stats.Recorded(count: recordings.count, totalMs: totalMs),
        equivalence: totalMs < minEquivalenceMs
            ? nil : equivalence(totalMs: totalMs, today: input.today, current: current, recordings: recordings),
        months: months(
            today: input.today,
            tunesAdded: entries.compactMap { localDate($0.userTune.createdAt, in: zone) },
            recorded: recordings.compactMap { localDate($0.recordedAt, in: zone) }
        ),
        heatmap: heatmap(input, zone: zone, entries: entries, recordings: recordings),
        onThisDay: onThisDay(input, zone: zone, entries: entries, recordings: recordings),
        breakdowns: breakdowns(current, instruments: input.instruments),
        rarities: rarities(current, instruments: input.instruments)
    )
}

/// A recording's length between its trim points, or zero before its duration is known.
private func trimmedLength(_ recording: StatsInput.Recording) -> Int {
    let end = recording.trimEndMs ?? recording.durationMs ?? 0
    return max(0, end - recording.trimStartMs)
}

// MARK: - Catalog

/// Every user-tune not deleted, with its tune when that is not deleted either.
private func catalogEntries(_ input: StatsInput) -> [StatsEntry] {
    var tuneByID: [TextKey: StatsInput.Tune] = [:]
    for tune in input.tunes where !isSet(tune.deletedAt) { tuneByID[TextKey(tune.id)] = tune }
    return input.userTunes.compactMap { userTune in
        guard let tune = tuneByID[TextKey(userTune.tuneID)], !isSet(userTune.deletedAt) else { return nil }
        return StatsEntry(tune: tune, userTune: userTune)
    }
}

private func counts(_ input: StatsInput, entries: [StatsEntry], current: [StatsEntry]) -> Stats.Counts {
    func withStatus(_ status: String) -> Int { current.count { $0.userTune.status == status } }
    let currentTunes = Set(current.map { TextKey($0.tune.id) })
    let scans = input.scans.filter { !isSet($0.deletedAt) && currentTunes.contains(TextKey($0.tuneID)) }
    return Stats.Counts(
        known: withStatus("known"),
        learning: withStatus("learning"),
        wantToLearn: withStatus("want_to_learn"),
        tunes: current.count,
        archived: entries.count - current.count,
        lists: input.lists.count { !isSet($0.deletedAt) },
        recordings: input.recordings.count { !isSet($0.deletedAt) },
        links: input.recordingLinks.count { !isSet($0.deletedAt) },
        scans: scans.count,
        scanTunes: Set(scans.map { TextKey($0.tuneID) }).count
    )
}

// MARK: - Equivalence

private func median(_ sorted: [Int]) -> Double {
    let middle = sorted.count / 2
    return sorted.count % 2 == 1
        ? Double(sorted[middle]) : Double(sorted[middle - 1] + sorted[middle]) / 2
}

/// The tune with the most recordings that have a length, and its median length.
private func mostRecordedTune(
    current: [StatsEntry], recordings: [StatsInput.Recording]
) -> (tuneID: String, medianMs: Double)? {
    var lengths: [TextKey: [Int]] = [:]
    for recording in recordings {
        let length = trimmedLength(recording)
        if let tuneID = recording.tuneID, isSet(tuneID), length > 0 {
            lengths[TextKey(tuneID), default: []].append(length)
        }
    }
    let ranked = current.filter { lengths[TextKey($0.tune.id)] != nil }.sorted { a, b in
        let countA = lengths[TextKey(a.tune.id)]!.count
        let countB = lengths[TextKey(b.tune.id)]!.count
        if countA != countB { return countA > countB }
        let byTitle = compareText(a.tune.title, b.tune.title)
        return byTitle != 0 ? byTitle < 0 : precedes(a.tune.id, b.tune.id)
    }
    guard let top = ranked.first else { return nil }
    return (top.tune.id, median(lengths[TextKey(top.tune.id)]!.sorted()))
}

/// One comparison per day: the date picks among the entries the total fits.
private func equivalence(
    totalMs: Int, today: String, current: [StatsEntry], recordings: [StatsInput.Recording]
) -> Stats.Equivalence? {
    let tune = mostRecordedTune(current: current, recordings: recordings)
    let candidates = equivalences.filter {
        totalMs >= $0.minMs && totalMs <= $0.maxMs && ($0.id != .tune || tune != nil)
    }
    guard !candidates.isEmpty, let todayDay = PlainDate(today)?.daysSinceEpoch else { return nil }
    let pick = candidates[floorMod(todayDay, candidates.count)]
    let unitMs = pick.id == .tune ? tune!.medianMs : Double(pick.unitMs!)
    let n = max(1, Int((Double(totalMs) / unitMs).rounded()))
    return Stats.Equivalence(id: pick.id, n: n, tuneID: pick.id == .tune ? tune!.tuneID : nil)
}

// MARK: - Months

private func months(today: String, tunesAdded: [String], recorded: [String]) -> Stats.Months {
    let thisMonth = String(today.prefix(7))
    func tally(_ dates: [String]) -> [String: Int] {
        var byMonth: [String: Int] = [:]
        for date in dates { byMonth[String(date.prefix(7)), default: 0] += 1 }
        return byMonth
    }
    let tunes = tally(tunesAdded)
    let recordings = tally(recorded)
    func row(_ month: String) -> Stats.Month {
        Stats.Month(month: month, tunesAdded: tunes[month] ?? 0, recordings: recordings[month] ?? 0)
    }
    let last12 = monthsBetween(addMonths(thisMonth, -11), thisMonth).map(row)
    let first = (Array(tunes.keys) + Array(recordings.keys))
        .filter { !precedes(thisMonth, $0) }
        .min(by: precedes)
    return Stats.Months(
        last12: last12,
        allTime: first.map { monthsBetween($0, thisMonth).map(row) } ?? [],
        hasAllTime: first.map { precedes($0, last12[0].month) } ?? false
    )
}

// MARK: - Heatmap

private func emptyDay(_ date: String) -> Stats.Day {
    Stats.Day(
        date: date, musicMs: 0, plays: 0, practiceSessions: 0, scanViews: 0, tunesAdded: 0, recordings: 0,
        statusChanges: 0, level: 0)
}

/// Four steps by quartile of the musician's own days with music: `q(p)` is the nearest-rank
/// value, `v[ceil(p * n) - 1]` of the ascending lengths. A day active with no music is level 1.
private func assignLevels(_ days: inout [Stats.Day]) {
    let lengths = days.map(\.musicMs).filter { $0 > 0 }.sorted()
    func q(_ p: Double) -> Int { lengths[Int((p * Double(lengths.count)).rounded(.up)) - 1] }
    for index in days.indices {
        let day = days[index]
        let active =
            day.plays > 0 || day.practiceSessions > 0 || day.scanViews > 0 || day.tunesAdded > 0
            || day.recordings > 0 || day.statusChanges > 0
        days[index].level =
            if day.musicMs > 0 {
                day.musicMs <= q(0.25) ? 1 : day.musicMs <= q(0.5) ? 2 : day.musicMs <= q(0.75) ? 3 : 4
            } else {
                active ? 1 : 0
            }
    }
}

private func heatmap(
    _ input: StatsInput, zone: TimeZone, entries: [StatsEntry], recordings: [StatsInput.Recording]
) -> Stats.Heatmap {
    guard let today = PlainDate(input.today) else {
        return Stats.Heatmap(visible: false, start: input.today, days: [])
    }
    let startDay = today.daysSinceEpoch - today.weekday - heatmapWeeks * 7
    var days = (startDay...today.daysSinceEpoch).map { emptyDay(PlainDate(daysSinceEpoch: $0).text) }
    func index(_ instant: String) -> Int? {
        guard let date = localPlainDate(instant, in: zone) else { return nil }
        let offset = date.daysSinceEpoch - startDay
        return days.indices.contains(offset) ? offset : nil
    }
    for play in input.playEvents {
        guard let i = index(play.startedAt) else { continue }
        days[i].plays += 1
        days[i].musicMs += play.listenedMs
    }
    for session in input.practiceSessions {
        guard let i = index(session.startedAt) else { continue }
        days[i].practiceSessions += 1
        days[i].musicMs += session.durationMs
    }
    for view in input.scanViews {
        guard let i = index(view.startedAt) else { continue }
        days[i].scanViews += 1
    }
    for recording in recordings {
        guard let i = index(recording.recordedAt) else { continue }
        days[i].recordings += 1
        days[i].musicMs += trimmedLength(recording)
    }
    for entry in entries {
        guard let i = index(entry.userTune.createdAt) else { continue }
        days[i].tunesAdded += 1
    }
    // A user-tune's first row records its creation, already counted as a tune added.
    for change in input.statusChanges where isSet(change.fromStatus) {
        guard let i = index(change.changedAt) else { continue }
        days[i].statusChanges += 1
    }
    assignLevels(&days)
    return Stats.Heatmap(
        visible: days.count { $0.level > 0 } >= minVisibleDays,
        start: PlainDate(daysSinceEpoch: startDay).text,
        days: days
    )
}

// MARK: - On this day

/// The position of the earliest row, so a duplicate ID never marks two rows first.
private func earliest<Row>(
    _ rows: [Row], id: (Row) -> String, instant: (Row) -> String
) -> Int? {
    func milliseconds(_ row: Row) -> Int64 { Timestamp(iso: instant(row))?.milliseconds ?? .max }
    return rows.indices.min { a, b in
        let (msA, msB) = (milliseconds(rows[a]), milliseconds(rows[b]))
        return msA != msB ? msA < msB : precedes(id(rows[a]), id(rows[b]))
    }
}

private func onThisDay(
    _ input: StatsInput, zone: TimeZone, entries: [StatsEntry], recordings: [StatsInput.Recording]
) -> [Stats.OnThisDay] {
    guard let today = PlainDate(input.today) else { return [] }
    func yearsAgo(_ date: String) -> Int? {
        guard let anchor = PlainDate(date) else { return nil }
        let sameDay =
            (anchor.month == today.month && anchor.day == today.day)
            || (anchor.month == 2 && anchor.day == 29 && today.month == 2 && today.day == 28
                && !isLeapYear(today.year))
        return sameDay && anchor.year < today.year ? today.year - anchor.year : nil
    }
    let firstTune = earliest(entries.map(\.userTune), id: \.id, instant: \.createdAt)
    let firstRecording = earliest(recordings, id: \.id, instant: \.recordedAt)
    var lines: [Stats.OnThisDay] = []
    func add(_ kind: Stats.OnThisDayKind, _ id: String, _ date: String?) {
        if let date, let years = yearsAgo(date) { lines.append(Stats.OnThisDay(kind: kind, id: id, years: years)) }
    }
    for (index, entry) in entries.enumerated() {
        add(
            index == firstTune ? .firstTune : .tuneAdded,
            entry.tune.id,
            localDate(entry.userTune.createdAt, in: zone)
        )
        if let learnedOn = present(entry.userTune.learnedOn) { add(.learned, entry.tune.id, learnedOn) }
    }
    for (index, recording) in recordings.enumerated() {
        add(
            index == firstRecording ? .firstRecording : .recording,
            recording.id,
            localDate(recording.recordedAt, in: zone)
        )
    }
    func isFirst(_ line: Stats.OnThisDay) -> Int { line.kind == .firstTune || line.kind == .firstRecording ? 0 : 1 }
    // Swift's sort is stable, as the web's is, so lines that tie keep the order they were added in.
    return Array(
        lines.sorted { a, b in
            if isFirst(a) != isFirst(b) { return isFirst(a) < isFirst(b) }
            if a.years != b.years { return a.years > b.years }
            return precedes(a.id, b.id)
        }
        .prefix(maxOnThisDay))
}
