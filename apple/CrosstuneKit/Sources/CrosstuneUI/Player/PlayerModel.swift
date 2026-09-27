import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation

/// Something the player can load: one of the musician's recordings or a link, by id, with the
/// title the player shows.
public struct PlayerItem: Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        case recording
        case link
    }

    public let kind: Kind
    public let id: String
    public let title: String
    /// The tune a recording belongs to, for the system's Now Playing; nil for a link.
    public let tuneTitle: String?
    /// What a link plays and where its provider shows it; nil for a recording.
    public let link: LinkPlayback?
    /// A recording's stored row, whose trim, speed, and pitch it plays; nil for a link.
    public let recording: Recording?

    public init(
        kind: Kind, id: String, title: String, tuneTitle: String? = nil, link: LinkPlayback? = nil,
        recording: Recording? = nil
    ) {
        self.kind = kind
        self.id = id
        self.title = title
        self.tuneTitle = tuneTitle
        self.link = link
        self.recording = recording
    }
}

/// A loaded link's player and the provider's own page for it.
public struct LinkPlayback: Hashable, Sendable {
    public let embed: Embed
    /// The provider's name, for "Open in YouTube".
    public let providerName: String
    /// The provider's page for the link, or nil when the stored URL must not be opened.
    public let providerURL: URL?

    public init(embed: Embed, providerName: String, providerURL: URL?) {
        self.embed = embed
        self.providerName = providerName
        self.providerURL = providerURL
    }
}

extension PlayerItem {
    /// A recording as the player names it: its label, then its tune's title, then when it was
    /// made. The player stands apart from any heading, so the tune is never dropped.
    public static func recording(
        _ recording: Recording, tuneTitle: String?, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> PlayerItem {
        PlayerItem(
            kind: .recording, id: recording.id,
            title: RecordingText.title(recording, tuneTitle: tuneTitle, locale: locale, timeZone: timeZone),
            tuneTitle: tuneTitle, recording: recording)
    }

    /// A link as the player loads it, or nil when it has no player and can only open elsewhere.
    /// Only a play tap loads the player, so the embed always starts playing.
    public static func link(_ link: RecordingLink) -> PlayerItem? {
        guard link.deletedAt == nil, let embed = Embed.for(link, autoplay: true) else { return nil }
        return PlayerItem(
            kind: .link, id: link.id, title: LinkText.title(link),
            link: LinkPlayback(
                embed: embed, providerName: LinkText.providerLabel(link.provider),
                providerURL: LinkText.outboundURL(link.url)))
    }
}

/// Where a loaded recording's audio stands.
public enum RecordingAudio: Equatable, Sendable {
    /// Looking for the audio on this device, or fetching it from the server.
    case fetching
    /// In the audio player, playing or paused.
    case loaded
    /// Neither on this device nor fetched: offline, not ready, or the fetch failed.
    case unavailable
}

/// A recording's audio file on this device, with the file row that says where in the source
/// its audio starts.
public struct RecordingAudioFile: Equatable, Sendable {
    public let url: URL
    public let file: RecordingFile

    public init(url: URL, file: RecordingFile) {
        self.url = url
        self.file = file
    }
}

/// A recording's speed and pitch, where nil leaves that one as it is.
public struct PlaybackSettings: Equatable, Sendable {
    public var speedPercent: Int?
    public var pitchCents: Int?

    public init(speedPercent: Int? = nil, pitchCents: Int? = nil) {
        self.speedPercent = speedPercent
        self.pitchCents = pitchCents
    }
}

/// The settings the recording screen changes while the recording plays.
enum PlaybackSetting: CaseIterable, Sendable {
    case speed
    case pitch

    var standard: Int {
        switch self {
        case .speed: 100
        case .pitch: 0
        }
    }

    func value(of recording: Recording) -> Int {
        switch self {
        case .speed: recording.speedPercent
        case .pitch: recording.pitchCents
        }
    }

    func value(of settings: PlaybackSettings?) -> Int? {
        switch self {
        case .speed: settings?.speedPercent
        case .pitch: settings?.pitchCents
        }
    }

    func change(_ value: Int) -> PlaybackSettings {
        switch self {
        case .speed: PlaybackSettings(speedPercent: value)
        case .pitch: PlaybackSettings(pitchCents: value)
        }
    }

    var notSaved: String {
        switch self {
        case .speed: RecordingScreenText.speedNotSaved
        case .pitch: RecordingScreenText.pitchNotSaved
        }
    }
}

/// What is loaded in the player, shared by every screen that can start playback. At most one
/// item is loaded, and it stays loaded while the musician browses until they close it. Only one
/// thing plays at a time: loading a recording takes a link's player away, and loading a link
/// stops a recording.
///
/// A loaded recording plays its row's trim, speed, and pitch, and follows each as it changes
/// without reloading. Speed and pitch changed here play at once and are written to the row once
/// they settle, so a slider dragged through dozens of values writes one change.
@MainActor
@Observable
public final class PlayerModel {
    /// Finds a recording's audio file on this device, fetching it first when it is not here.
    /// Nil when there is nothing to play.
    public typealias AudioSource = @MainActor (_ recordingID: String) async -> RecordingAudioFile?
    /// Writes a recording's settled speed or pitch to its row.
    public typealias SettingsWriter =
        @MainActor (_ recordingID: String, _ change: PlaybackSettings) async throws -> Void

    /// The loaded item, or nil when nothing is loaded.
    public private(set) var item: PlayerItem?
    /// Whether the loaded item's player shows in full: a recording's screen, or on iPhone a
    /// link's player. One request shared by every window, which only the window that made it
    /// answers; see ``showsExpanded(in:)``. Letting go of it writes any change still settling
    /// and lets go of every hold, since only a screen inside it holds.
    public var isExpanded = false {
        didSet {
            guard oldValue && !isExpanded else { return }
            expandedWindow = nil
            flushSettings()
            releaseHolds()
        }
    }
    /// The window that asked for the player in full, or nil when any window may show it.
    public private(set) var expandedWindow: UUID?
    /// Where the loaded recording's audio stands; nil unless a recording is loaded.
    public private(set) var recordingAudio: RecordingAudio?
    /// Why the last change to the loaded recording, a speed, a pitch, or a delete, did not
    /// land, until the next change. Shown wherever the player is, so it outlasts the screen
    /// that made the change.
    public private(set) var failure: String?
    /// Plays a loaded recording's audio.
    public let audio: any AudioPlayback
    /// Where a recording's audio comes from. The shell sets it once it has a store; until then
    /// a recording has no audio to play, and a recording loaded before it arrives looks again.
    @ObservationIgnored public var audioSource: AudioSource? {
        didSet {
            guard let item, item.kind == .recording, recordingAudio != .loaded else { return }
            loadAudio(item)
        }
    }
    /// Where settled speed and pitch changes go. The shell sets it; without it they only play.
    @ObservationIgnored public var saveSettings: SettingsWriter?

    /// Whether a take is being recorded, when nothing may play: playback would change the
    /// audio session under the microphone, or be recorded into the take. The shell answers it
    /// from every window's record sheet; the audio player also stays silent during a take.
    @ObservationIgnored public var isCapturing: @MainActor () -> Bool = { false }

    /// How long a speed or pitch holds still before it is written.
    @ObservationIgnored var settleDelay: Duration = .seconds(1)

    @ObservationIgnored private var fetch: Task<Void, Never>?
    /// The file the audio player holds, and its full length before any window.
    @ObservationIgnored private var loadedFile: (audio: RecordingAudioFile, duration: TimeInterval?)?
    /// Changes made here that the row does not hold yet. Each wins over the row until the row
    /// catches up, or until a value from elsewhere lands once it is no longer settling.
    private var edits: [PlaybackSetting: Int] = [:]
    @ObservationIgnored private var settling: [PlaybackSetting: Task<Void, Never>] = [:]
    /// Settled writes under way, so leaving the store can wait for them.
    @ObservationIgnored private var writing: [UUID: Task<Void, Never>] = [:]
    /// Settings that play in place of the row's and the edits, by recording, such as the trim
    /// screen's normal speed and pitch.
    @ObservationIgnored private var held: [String: PlaybackSettings] = [:]
    /// What the audio player was last told, so a change that plays the same is not sent again.
    @ObservationIgnored private var applied: [PlaybackSetting: Int] = [:]

    /// The loaded item's title, or nil when nothing is loaded.
    public var title: String? { item?.title }

    public var isLoaded: Bool { item != nil }

    /// The loaded recording's speed, with a change made here ahead of its row.
    public var speedPercent: Int { setting(.speed) }
    /// The loaded recording's pitch shift in cents, with a change made here ahead of its row.
    public var pitchCents: Int { setting(.pitch) }

    /// - Parameter audio: Plays recordings; nil is the device's player.
    public init(audio: (any AudioPlayback)? = nil) {
        self.audio = audio ?? AudioPlayer()
    }

    /// Whether `kind` with `id` is the loaded item.
    public func holds(_ kind: PlayerItem.Kind, id: String) -> Bool {
        item?.kind == kind && item?.id == id
    }

    /// Loads an item and starts it, in place of whatever was loaded. Only a play tap calls this:
    /// opening a screen never loads the player. A link opens in full, since its provider's player
    /// is what plays it; a recording plays from the bar. Refused, returning false, while a take
    /// is being recorded.
    @discardableResult
    public func play(_ item: PlayerItem) -> Bool {
        guard !isCapturing() else { return false }
        stopAudio()
        self.item = item
        expandedWindow = nil
        isExpanded = item.link != nil
        if item.kind == .recording { loadAudio(item) }
        return true
    }

    /// Shows a recording's screen in `window`, starting the recording first when it is not the
    /// one loaded. Refused, returning false, while a take is being recorded.
    @discardableResult
    public func open(_ item: PlayerItem, in window: UUID? = nil) -> Bool {
        if !holds(item.kind, id: item.id) {
            guard play(item) else { return false }
        }
        expand(in: window)
        return true
    }

    /// Shows the loaded item's player in full in `window`, or in any window when nil.
    public func expand(in window: UUID? = nil) {
        guard item != nil else { return }
        expandedWindow = window
        isExpanded = true
    }

    /// Whether `window` shows the player in full: only the window that asked for it, so every
    /// other window sharing this player carries on as it was.
    public func showsExpanded(in window: UUID?) -> Bool {
        guard isExpanded else { return false }
        guard let expandedWindow, let window else { return true }
        return expandedWindow == window
    }

    /// Unloads the item, which stops it and takes the player off screen.
    public func close() {
        stopAudio()
        item = nil
        isExpanded = false
    }

    /// Tries the loaded recording's audio again after it could not be found or fetched.
    public func retryAudio() {
        guard let item, item.kind == .recording, recordingAudio == .unavailable else { return }
        loadAudio(item)
    }

    /// Plays the loaded recording at `percent` of normal speed now, and writes it once it settles.
    public func setSpeed(_ percent: Int) {
        change(.speed, to: percent)
    }

    /// Shifts the loaded recording's pitch by `cents` now, and writes it once it settles.
    public func setPitch(_ cents: Int) {
        change(.pitch, to: cents)
    }

    /// Plays `settings` for recording `id` in place of its own until let go with nil. A field
    /// left nil plays the recording's own.
    public func hold(_ id: String, _ settings: PlaybackSettings?) {
        held[id] = settings
        guard holds(.recording, id: id) else { return }
        for setting in PlaybackSetting.allCases { apply(setting) }
    }

    /// Writes every speed or pitch change still settling now.
    public func flushSettings() {
        guard let item, item.kind == .recording else { return }
        for setting in PlaybackSetting.allCases where settling[setting] != nil {
            settle(setting, id: item.id)
        }
    }

    /// Writes every change still settling and returns once every write has landed, so the store
    /// can be left with nothing still writing to it.
    public func finishSettings() async {
        flushSettings()
        while let (id, write) = writing.first {
            await write.value
            writing[id] = nil
        }
    }

    /// Lets go of the store the player writes to: changes still settling are dropped rather
    /// than written to a store that is closing, and the player closes.
    public func leaveStore() {
        cancelSettling()
        saveSettings = nil
        close()
    }

    /// Deletes the loaded recording with `delete`. The audio player lets go of the file first;
    /// when the delete fails, the recording loads again where it was and the failure shows.
    public func deleteLoadedRecording(_ delete: () async throws -> Void) async {
        guard let item, item.kind == .recording else { return }
        let id = item.id
        // A recording being deleted has nowhere to write its speed or pitch.
        cancelSettling()
        isExpanded = false
        let position = audio.elapsed
        let wasPlaying = audio.isPlaying
        fetch?.cancel()
        if recordingAudio == .loaded { audio.unload() }
        recordingAudio = .fetching
        loadedFile = nil
        applied = [:]
        do {
            try await delete()
            if holds(.recording, id: id) { close() }
        } catch {
            guard holds(.recording, id: id) else { return }
            failure = ListModel.message(error)
            loadAudio(self.item ?? item, at: position, playing: wasPlaying)
        }
    }

    /// Follows the stored row of the loaded link `id`: a new title or player replaces the
    /// loaded one, and a row that is gone, deleted, or no longer playable closes the player.
    /// Does nothing when another item is loaded.
    public func linkChanged(id: String, to row: RecordingLink?) {
        guard holds(.link, id: id) else { return }
        guard let row, let next = PlayerItem.link(row) else {
            close()
            return
        }
        if next != item { item = next }
    }

    /// Follows the stored row of the loaded recording `id`, its audio file on this device, and
    /// the title of its tune: a new name shows in place, and a row that is gone or deleted
    /// closes the player. The audio already playing carries on, taking a new trim, speed, or
    /// pitch in place, and a new file of the audio reloads at the same position. Does nothing
    /// when another item is loaded.
    public func recordingChanged(
        id: String, to row: Recording?, audioFile: RecordingAudioFile?, tuneTitle: String?,
        locale: Locale = .current, timeZone: TimeZone = .current
    ) {
        guard holds(.recording, id: id) else { return }
        guard let row, row.deletedAt == nil else {
            close()
            return
        }
        let previous = item
        let next = PlayerItem.recording(row, tuneTitle: tuneTitle, locale: locale, timeZone: timeZone)
        if next != previous { item = next }
        let before = previous?.recording
        let changed = PlaybackSetting.allCases.filter { before.map($0.value(of:)) != $0.value(of: row) }
        for setting in changed { follow(setting, row: row) }
        guard recordingAudio == .loaded else { return }
        if next.title != previous?.title || next.tuneTitle != previous?.tuneTitle {
            audio.retitle(NowPlaying(title: next.title, tuneTitle: next.tuneTitle))
        }
        // Each revision of the audio is a new file, so a new URL is the only change that reloads.
        if let audioFile, audioFile.url != loadedFile?.audio.url {
            let position = audio.elapsed
            let wasPlaying = audio.isPlaying
            start(audioFile, next)
            audio.seek(to: position)
            if wasPlaying { audio.play() }
            return
        }
        if before.map(Self.trim) != Self.trim(row), let window = window(row) {
            audio.setWindow(window)
        }
        for setting in changed { apply(setting) }
    }

    private static func trim(_ row: Recording) -> [Int64?] {
        [row.trimStartMs, row.trimEndMs, row.sourceDurationMs]
    }

    /// Fetches and loads `item`'s audio, then plays it from the start, or from `position` and
    /// only if `playing`.
    private func loadAudio(_ item: PlayerItem, at position: TimeInterval? = nil, playing: Bool = true) {
        fetch?.cancel()
        recordingAudio = .fetching
        let source = audioSource
        let id = item.id
        fetch = Task { [weak self] in
            let file = await source?(id)
            guard let self, !Task.isCancelled, holds(.recording, id: id) else { return }
            guard let file else {
                recordingAudio = .unavailable
                return
            }
            start(file, self.item ?? item)
            if let position { audio.seek(to: position) }
            // A take started while the audio was fetched keeps the microphone to itself.
            if playing && !isCapturing() { audio.play() }
        }
    }

    /// Loads `file` paused at its start, playing `item`'s trim, speed, and pitch.
    private func start(_ file: RecordingAudioFile, _ item: PlayerItem) {
        audio.load(file.url, nowPlaying: NowPlaying(title: item.title, tuneTitle: item.tuneTitle))
        loadedFile = (file, audio.duration)
        applied = [:]
        recordingAudio = .loaded
        guard let row = item.recording else { return }
        if let window = window(row) { audio.setWindow(window) }
        for setting in PlaybackSetting.allCases { apply(setting) }
    }

    private func window(_ row: Recording) -> PlaybackWindow? {
        guard let loadedFile else { return nil }
        // A file whose length is unknown has failed to open; the window's end is then the row's.
        return PlaybackWindow.make(
            recording: row, file: loadedFile.audio.file, fileDuration: loadedFile.duration ?? .infinity)
    }

    private func setting(_ setting: PlaybackSetting) -> Int {
        edits[setting] ?? item?.recording.map(setting.value(of:)) ?? setting.standard
    }

    /// Tells the audio player what `setting` should play now, when that has changed.
    private func apply(_ setting: PlaybackSetting) {
        guard recordingAudio == .loaded, let id = item?.id else { return }
        let value = setting.value(of: held[id]) ?? self.setting(setting)
        guard applied[setting] != value else { return }
        applied[setting] = value
        switch setting {
        case .speed: audio.setRate(value)
        case .pitch: audio.setPitch(cents: value)
        }
    }

    private func change(_ setting: PlaybackSetting, to value: Int) {
        guard let item, item.kind == .recording else { return }
        edits[setting] = value
        failure = nil
        apply(setting)
        settling[setting]?.cancel()
        let id = item.id
        let delay = settleDelay
        settling[setting] = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.settle(setting, id: id)
        }
    }

    /// Writes `setting`'s edit for recording `id`, unless the row already holds it.
    private func settle(_ setting: PlaybackSetting, id: String) {
        settling.removeValue(forKey: setting)?.cancel()
        guard holds(.recording, id: id), let value = edits[setting] else { return }
        guard value != item?.recording.map(setting.value(of:)) else {
            edits[setting] = nil
            return
        }
        guard let saveSettings else { return }
        let key = UUID()
        writing[key] = Task { [weak self] in
            defer { self?.writing[key] = nil }
            do {
                try await saveSettings(id, setting.change(value))
            } catch CommandError.recordingNotFound {
                // The recording is gone, and the player goes with it.
            } catch {
                guard let self, holds(.recording, id: id) else { return }
                failure = setting.notSaved
                // What plays and shows goes back to what the row holds, unless a newer change
                // has been made since.
                if edits[setting] == value && settling[setting] == nil {
                    edits[setting] = nil
                    apply(setting)
                }
            }
        }
    }

    /// Takes the row's new value for `setting`, unless an edit made here is still settling. An
    /// edit the row now holds, or one already written that a newer value from elsewhere
    /// replaced, gives way to the row. The caller applies it.
    private func follow(_ setting: PlaybackSetting, row: Recording) {
        if let edit = edits[setting], settling[setting] == nil || edit == setting.value(of: row) {
            edits[setting] = nil
        }
    }

    private func releaseHolds() {
        guard !held.isEmpty else { return }
        held = [:]
        for setting in PlaybackSetting.allCases { apply(setting) }
    }

    private func cancelSettling() {
        for task in settling.values { task.cancel() }
        settling = [:]
        edits = [:]
    }

    private func stopAudio() {
        flushSettings()
        fetch?.cancel()
        fetch = nil
        if recordingAudio == .loaded { audio.unload() }
        recordingAudio = nil
        loadedFile = nil
        applied = [:]
        edits = [:]
        held = [:]
        failure = nil
    }
}
