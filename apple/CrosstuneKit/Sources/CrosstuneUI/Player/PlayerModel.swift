import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation

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
            // Opened and closed without a play reads as browsing, so it leaves nothing loaded.
            if opensUnplayed && transport?.isPlaying != true { close() }
        }
    }
    /// The window that asked for the player in full, or nil when any window may show it.
    public private(set) var expandedWindow: UUID?
    /// True from a paused ``open(_:in:playing:)`` that loaded the item until its audio first plays.
    private(set) var opensUnplayed = false
    /// The recording screen whose visit is open.
    @ObservationIgnored private var visitScreen: UUID?
    /// Where the player was last asked for in full, which a recording screen's visit reports.
    @ObservationIgnored private var expandSource = ActionSource.dock
    /// The loaded recording's loops, the selected one, and Repeat.
    public let loops: LoopPlayback
    /// Where the loaded recording's audio stands; nil unless a recording is loaded.
    public private(set) var recordingAudio: RecordingAudio?
    /// Why the last change to the loaded recording, a speed, a pitch, or a delete, did not
    /// land, until the next change. Shown wherever the player is, so it outlasts the screen
    /// that made the change.
    public private(set) var failure: String?
    /// The queue driving the player, while one does. Weak, so a queue that goes away lets the
    /// player carry on as it was.
    public weak var queue: (any PlayerQueue)?
    /// Called when something loads outside a queue, so a playlist's leftover message can go.
    @ObservationIgnored public var onPlayedOutsideQueue: (@MainActor () -> Void)?
    /// What the loaded queued recording shows on the system's Now Playing surfaces, which the
    /// item's own title would otherwise replace. Nil outside a queue.
    @ObservationIgnored private var queuedNowPlaying: NowPlaying?
    /// Whether MusicKit holds the loaded song as a guard queue, which only a queue watches.
    @ObservationIgnored private var loadedGuarded = false
    /// The background reload that frees a guarded song once its queue has left.
    @ObservationIgnored private var releasing: Task<Void, Never>?
    /// Plays a loaded recording's audio.
    public let audio: any AudioPlayback
    /// Plays Apple Music links in full; nil plays every link in its embed.
    public let appleMusic: AppleMusic?
    /// How the loaded link plays; nil unless a link is loaded.
    public private(set) var linkAudio: LinkAudio?
    /// Where a recording's audio comes from. The shell sets it once it has a store; until then
    /// a recording has no audio to play, and a recording loaded before it arrives looks again.
    @ObservationIgnored public var audioSource: AudioSource? {
        didSet {
            guard let item, item.kind == .recording, recordingAudio != .loaded else { return }
            loadAudio(item, playing: !opensUnplayed)
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

    /// Logs each play and recording screen visit.
    @ObservationIgnored let activity: PlayerActivity
    let analytics: AnalyticsClient
    /// Follows the state the activity log times.
    @ObservationIgnored private var following: Task<Void, Never>?
    /// Whether the queue hears each track's end, as it does from loading a track until it leaves.
    @ObservationIgnored private var queueHearsTrackEnds = false
    /// Where plays and practice sessions are written. The shell sets it; without it nothing is.
    /// One for another store drops the play under way.
    @ObservationIgnored public var activityWriter: ActivityWriter? {
        didSet { activity.setWriter(activityWriter) }
    }

    @ObservationIgnored private var fetch: Task<Void, Never>?
    /// Asking for access and finding the loaded Apple Music link's track.
    @ObservationIgnored private var deciding: Task<Void, Never>?
    /// Ends a decision that the network holds up, so the link falls back to its embed.
    @ObservationIgnored private var deadline: Task<Void, Never>?
    /// How long finding and starting an Apple Music track may take before the embed plays
    /// instead. The access prompt does not count, since it waits on the musician.
    @ObservationIgnored var decisionTimeout: Duration = .seconds(10)
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
    private var held: [String: PlaybackSettings] = [:]
    /// What the audio player was last told, so a change that plays the same is not sent again.
    @ObservationIgnored private var applied: [PlaybackSetting: Int] = [:]

    /// The loaded item's title, or nil when nothing is loaded.
    public var title: String? { item?.title }

    public var isLoaded: Bool { item != nil }

    /// The loaded link's embed, only while the embed is what plays it.
    public var embed: Embed? { linkAudio == .embed ? item?.link?.embed : nil }

    /// The MusicKit player while it plays the loaded link.
    public var music: (any MusicPlayback)? { linkAudio == .native ? appleMusic?.player : nil }

    /// Whether the bar carries play and pause: a recording, or a link MusicKit plays.
    public var playsInBar: Bool { item?.kind == .recording || linkAudio == .native }

    /// What play, pause, and skip act on: the link MusicKit plays, or the loaded recording once
    /// its audio plays. Nil while nothing here can be played, such as a link in its embed.
    public var transport: (any PlaybackTransport)? {
        if let music { return music }
        guard recordingAudio == .loaded, !audio.hasFailed else { return nil }
        return audio
    }

    /// The loaded recording's speed, with a change made here ahead of its row.
    public var speedPercent: Int { setting(.speed) }
    /// The loaded recording's pitch shift in cents, with a change made here ahead of its row.
    public var pitchCents: Int { setting(.pitch) }

    /// - Parameters:
    ///   - audio: Plays recordings; nil is the device's player.
    ///   - appleMusic: Plays Apple Music links in full; nil plays every link in its embed.
    ///   - clock: Measures how long each play and practice session plays. It stops while the
    ///     device sleeps, so a sleep never counts as playing time.
    ///   - now: The wall clock each play and practice session is stamped with.
    public init(
        audio: (any AudioPlayback)? = nil, appleMusic: AppleMusic? = nil,
        clock: @escaping @MainActor () -> SuspendingClock.Instant = { .now },
        now: @escaping @MainActor () -> Date = Date.init, analytics: AnalyticsClient = .noop
    ) {
        self.analytics = analytics
        self.audio = audio ?? AudioPlayer()
        self.appleMusic = appleMusic
        loops = LoopPlayback(audio: self.audio, analytics: analytics)
        activity = PlayerActivity(clock: clock, now: now, analytics: analytics)
        self.audio.onTrackEnd = { [weak self] end in self?.trackEnded(end) }
        appleMusic?.player.onTrackEnd = { [weak self] end in self?.trackEnded(end) }
        following = Task { [weak self] in
            for await snapshot in Observations({ @MainActor [weak self] in self?.activitySnapshot }) {
                guard let snapshot else { continue }
                if snapshot.playing, self?.opensUnplayed == true { self?.opensUnplayed = false }
                self?.activity.feed(snapshot)
            }
        }
    }

    isolated deinit {
        following?.cancel()
    }

    /// What the activity log follows, read from the transport that plays the loaded item.
    var activitySnapshot: ActivitySnapshot {
        let transport = transport
        let playing = transport?.isPlaying == true
        // Read only once stopped, so a playing position's every tick does not wake the log.
        let atEnd =
            !playing
            && transport.map { transport in transport.duration.map { transport.elapsed >= $0 - 1 } ?? false }
                ?? false
        return ActivitySnapshot(
            loaded: loadedSubject, playing: playing,
            lengthMs: transport?.duration.map { Int64(($0 * 1000).rounded()) } ?? 0,
            speedPercent: speedPercent, pitchCents: pitchCents,
            trimming: item.map { held[$0.id] != nil } ?? false,
            loopID: loops.isRepeating ? loops.selectedID : nil, atEnd: atEnd)
    }

    private var loadedSubject: PlaySubject? {
        item.map { PlaySubject(kind: $0.kind, id: $0.id) }
    }

    private func trackEnded(_ end: TrackEnd) {
        activity.trackEnded(end)
        if queueHearsTrackEnds { queue?.playerTrackEnded(end) }
    }

    /// The recording screen `screen` shows `recordingID`, whose row is `recording` when the
    /// caller has it: its time there is one visit, logged as practice or as a play once it closes.
    func screenOpened(_ recordingID: String, recording: Recording? = nil, by screen: UUID? = nil) {
        visitScreen = screen
        let row = recording ?? item?.recording.flatMap { $0.id == recordingID ? $0 : nil }
        activity.screenOpened(
            recordingID, kind: row.map { PlaybackKind(RecordingOrigin($0)) } ?? .recorded,
            tune: row.map { .known($0.tuneID) } ?? .lookUp, source: expandSource, loaded: loadedSubject,
            with: activitySnapshot)
    }

    /// The recording screen `screen` has gone. Only the screen that opened the visit last ends
    /// it, since another window's screen can go after this one has taken the visit over.
    func screenClosed(by screen: UUID? = nil) {
        guard screen == visitScreen else { return }
        visitScreen = nil
        activity.screenClosed(loaded: loadedSubject, with: activitySnapshot)
    }

    /// The app has gone to the background, and may never come back: a paused play and an open
    /// recording screen visit are written now.
    public func leftForeground() {
        activity.leftForeground(loaded: loadedSubject, with: activitySnapshot)
    }

    /// The app is quitting: the open play and recording screen visit end as closed, reported now
    /// so the caller's flush sends them. Unlike the background, playing audio keeps nothing open.
    public func appQuitting() {
        activity.appQuitting()
    }

    /// Opens the loaded link in its provider's own app or site with `open`, and reports it.
    public func openLinkInProvider(with open: (URL) -> Void) {
        guard let item, let link = item.link, let url = link.providerURL else { return }
        analytics.linkOpened(provider: link.provider, linkID: item.id)
        open(url)
    }

    /// The loaded link's embed sent the musician on to its provider's site.
    public func embedOpenedProvider() {
        guard let item, let link = item.link else { return }
        analytics.linkOpened(provider: link.provider, linkID: item.id)
    }

    /// Whether `kind` with `id` is the loaded item.
    public func holds(_ kind: PlayerItem.Kind, id: String) -> Bool {
        item?.kind == kind && item?.id == id
    }

    /// Loads an item and starts it, in place of whatever was loaded. Only a play tap, or a paused
    /// ``open(_:in:playing:)`` of a recording, loads the player. A link in its embed opens in
    /// full, since its provider's player is what plays it; a recording and a link MusicKit plays
    /// play from the bar, and a tap on the one already loaded resumes it, carrying on its play.
    /// `origin` is where the play is logged as asked for, and `source` where it is reported as
    /// started from. Refused, returning false, while a take is being recorded.
    @discardableResult
    public func play(_ item: PlayerItem, origin: PlayOrigin = .dock, source: ActionSource = .dock) -> Bool {
        load(item, origin: origin, playing: true, source: source)
    }

    private func load(_ item: PlayerItem, origin: PlayOrigin, playing: Bool, source: ActionSource) -> Bool {
        guard !isCapturing() else { return false }
        opensUnplayed = false
        let same = holds(item.kind, id: item.id)
        activity.begin(
            PlaySubject(kind: item.kind, id: item.id), origin: origin,
            attribution: PlayAttribution(item, source: source, queue: .single, trigger: .tap), keepsSame: same)
        // A queued song sits in a guard queue that reports to the queue; resuming it after the
        // queue is let go would pause on a guard copy, so it loads again unguarded.
        let queued = queue != nil || audio.holdsSession
        leaveAttachedQueue()
        onPlayedOutsideQueue?()
        if same, !queued, !loadedGuarded, let music {
            music.play()
            return true
        }
        stopAudio()
        loops.reset(forgettingRows: !same)
        self.item = item
        expandedWindow = nil
        if item.kind == .recording {
            isExpanded = false
            loadAudio(item, playing: playing)
        } else {
            startLink(item)
        }
        return true
    }

    /// Loads `item` for the queue and starts it, in place of whatever was loaded, even when it is
    /// the item already loaded: a queue's repeat and restart need the track loaded afresh, and a
    /// song's guard queue is spent once it reports an end. The player stays shown in full or not
    /// as it was, since the queue's controls live there. A track that cannot play here, which
    /// never falls back to an embed, closes the item and reaches
    /// ``PlayerQueue/playerCouldNotPlay()``. Refused, returning false, while a take is being
    /// recorded. A song with `autoplay` false loads paused at its start. Each load is a new play,
    /// logged as asked for from `origin` and reported as a list's track that `trigger` started.
    @discardableResult
    public func playQueued(
        _ item: PlayerItem, nowPlaying: NowPlaying, autoplay: Bool = true, origin: PlayOrigin = .dock,
        trigger: PlaybackTrigger
    ) -> Bool {
        loadQueued(item, nowPlaying: nowPlaying, autoplay: autoplay, origin: origin, trigger: trigger, keepsPlay: false)
    }

    /// ``playQueued(_:nowPlaying:autoplay:origin:trigger:)``, carrying on the open play when
    /// `keepsPlay` and it is of `item`.
    private func loadQueued(
        _ item: PlayerItem, nowPlaying: NowPlaying, autoplay: Bool, origin: PlayOrigin, trigger: PlaybackTrigger,
        keepsPlay: Bool
    ) -> Bool {
        guard !isCapturing() else { return false }
        opensUnplayed = false
        let same = holds(item.kind, id: item.id)
        activity.begin(
            PlaySubject(kind: item.kind, id: item.id), origin: origin,
            attribution: PlayAttribution(item, source: .list, queue: .playlist, trigger: trigger),
            keepsSame: keepsPlay)
        stopAudio()
        loops.reset(forgettingRows: !same)
        self.item = item
        queuedNowPlaying = nowPlaying
        audio.holdsSession = true
        audio.skipsByInterval = false
        queueHearsTrackEnds = true
        if item.kind == .recording {
            loadAudio(item)
        } else {
            startQueuedSong(item, autoplay: autoplay)
        }
        return true
    }

    /// Detaches the queue, which has finished or been replaced, and lets go of what it held,
    /// leaving the loaded item as it is. The queue is not told: it is the one leaving.
    public func leaveQueue() {
        detachQueue()
        releaseGuard()
    }

    /// A song left loaded when the queue goes has no one watching its guard queue, so play and
    /// the bar would resume a copy. It loads again in the background, unguarded and paused at
    /// its start. Nothing the musician sees changes meanwhile, and a failed load leaves the
    /// guard queue as it was. Any play, close, or new load takes over and cancels it.
    private func releaseGuard() {
        guard loadedGuarded, queue == nil, linkAudio == .native, let item, let kind = item.link?.appleMusic,
            let appleMusic
        else { return }
        let id = item.id
        releasing?.cancel()
        releasing = Task { [weak self] in
            guard await appleMusic.player.load(kind, guarded: false) else { return }
            guard let self, !Task.isCancelled, holds(.link, id: id), linkAudio == .native else { return }
            loadedGuarded = false
            releasing = nil
        }
    }

    private func detachQueue() {
        queue = nil
        queuedNowPlaying = nil
        queueHearsTrackEnds = false
        audio.skipsByInterval = true
        audio.holdsSession = false
        audio.releaseSession()
    }

    private func leaveAttachedQueue() {
        guard queue != nil || audio.holdsSession else { return }
        queue?.playerLeftQueue()
        detachQueue()
    }

    /// Shows a recording's screen in `window`, loading the recording first when it is not the
    /// one loaded: started, or paused at its start when `playing` is false. One loaded paused
    /// and closed before it ever plays is unloaded. Refused, returning false, while a take is
    /// being recorded. `source` is where the screen was asked for.
    @discardableResult
    public func open(
        _ item: PlayerItem, in window: UUID? = nil, playing: Bool = true, source: ActionSource = .dock
    ) -> Bool {
        if !holds(item.kind, id: item.id) {
            // Played from its own screen, which this opens on.
            guard load(item, origin: .dock, playing: playing, source: .recordingScreen) else { return false }
            opensUnplayed = !playing
        }
        expand(in: window, source: source)
        return true
    }

    /// Shows the loaded item's player in full in `window`, or in any window when nil. `source`
    /// is where it was asked for.
    public func expand(in window: UUID? = nil, source: ActionSource = .dock) {
        guard item != nil else { return }
        expandSource = source
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
        unloadItem()
        leaveAttachedQueue()
    }

    private func unloadItem(keepsExpansion: Bool = false) {
        activity.itemGone()
        queuedNowPlaying = nil
        stopAudio()
        loops.reset(forgettingRows: true)
        item = nil
        opensUnplayed = false
        if !keepsExpansion { isExpanded = false }
    }

    /// Tries the loaded recording's audio again after it could not be found or fetched.
    public func retryAudio() {
        guard let item, item.kind == .recording, recordingAudio == .unavailable else { return }
        loadAudio(item, playing: !opensUnplayed)
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

    /// Lets go of the store the player writes to: changes still settling and the play under way
    /// are dropped rather than written to a store that is closing, and the player closes.
    public func leaveStore() {
        activityWriter = nil
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
        // The delete decides whether the recording goes, so closing its screen must not.
        let screen = (shown: isExpanded, window: expandedWindow, unplayed: opensUnplayed)
        opensUnplayed = false
        isExpanded = false
        let position = audio.elapsed
        let wasPlaying = audio.isPlaying
        fetch?.cancel()
        if recordingAudio == .loaded { audio.unload() }
        loops.audioGone()
        recordingAudio = .fetching
        loadedFile = nil
        applied = [:]
        do {
            try await delete()
            if holds(.recording, id: id) { close() }
        } catch {
            guard holds(.recording, id: id) else { return }
            failure = failureMessage(error)
            loadAudio(self.item ?? item, at: position, playing: wasPlaying)
            // An unplayed open would otherwise stay loaded with no screen to close it, so its
            // screen comes back, showing the failure, where the delete was asked for.
            if screen.shown && screen.unplayed {
                expand(in: screen.window)
                opensUnplayed = true
            }
        }
    }

    /// Follows the stored row of the loaded link `id`: a new title or player replaces the
    /// loaded one, and a row that is gone, deleted, or no longer playable closes the player, or
    /// moves a queue on to its next track. Does nothing when another item is loaded.
    public func linkChanged(id: String, to row: RecordingLink?) {
        guard holds(.link, id: id) else { return }
        guard let row, let next = PlayerItem.link(row) else {
            dropGoneItem()
            return
        }
        guard next.link?.appleMusic == item?.link?.appleMusic else {
            if let nowPlaying = queuedNowPlaying {
                // A queued link plays only as a guarded song, and the queue moves on when it cannot.
                // A paused song stays paused, as with a single link.
                if case .song? = next.link?.appleMusic {
                    let autoplay = linkAudio == .deciding || music?.isPlaying == true
                    // The same link at a new address is still the play under way.
                    _ = loadQueued(
                        next, nowPlaying: nowPlaying, autoplay: autoplay, origin: activity.plays.origin ?? .dock,
                        trigger: activity.plays.attribution?.trigger ?? .autoAdvance, keepsPlay: true)
                } else {
                    queuedItemCannotPlay()
                }
                return
            }
            // A new address can mean another track, or one MusicKit cannot play. The player
            // stays as the musician left it: shown or not, and playing or not. A sync never
            // starts MusicKit or its access prompt; only a play tap still being decided does.
            let wasExpanded = isExpanded
            let wasDeciding = linkAudio == .deciding
            let wasPlaying = music?.isPlaying == true
            stopAudio()
            item = next
            startLink(
                next, autoplay: wasDeciding || wasPlaying, asksAccess: wasDeciding, expandsOnFallBack: wasExpanded)
            isExpanded = wasExpanded
            return
        }
        if next != item { item = next }
    }

    /// Follows the stored row of the loaded recording `id`, its audio file on this device, and
    /// the title of its tune: a new name shows in place, and a row that is gone or deleted
    /// closes the player, or moves a queue on to its next track. The audio already playing
    /// carries on, taking a new trim, speed, or pitch in place, and a new file of the audio
    /// reloads at the same position. Does nothing when another item is loaded.
    public func recordingChanged(
        id: String, to row: Recording?, audioFile: RecordingAudioFile?, tuneTitle: String?,
        locale: Locale = .current, timeZone: TimeZone = .current
    ) {
        guard holds(.recording, id: id) else { return }
        guard let row, row.deletedAt == nil else {
            dropGoneItem()
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
            audio.retitle(nowPlaying(for: next))
        }
        // Each revision of the audio is a new file, so a new URL is the only change that reloads.
        if let audioFile, audioFile.url != loadedFile?.audio.url {
            let position = audio.elapsed
            let wasPlaying = audio.isPlaying
            start(audioFile, next, keepLoop: true)
            audio.seek(to: position)
            if wasPlaying { audio.play() }
            return
        }
        if before.map(Self.trim) != Self.trim(row), let window = window(row) {
            audio.setWindow(window)
            loops.trimMoved(to: row.trimStartMs)
        }
        for setting in changed { apply(setting) }
    }

    /// Follows the loops of the loaded recording `id`. Does nothing when another item is loaded.
    public func loopsChanged(id: String, to rows: [RecordingLoop]) {
        guard holds(.recording, id: id) else { return }
        loops.follow(rows)
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
                guard queuedNowPlaying != nil else {
                    recordingAudio = .unavailable
                    return
                }
                queuedItemCannotPlay()
                return
            }
            start(file, self.item ?? item)
            if queuedNowPlaying != nil, audio.hasFailed {
                queuedItemCannotPlay()
                return
            }
            if let position { audio.seek(to: position) }
            // A take started while the audio was fetched keeps the microphone to itself.
            if playing && !isCapturing() { audio.play() }
        }
    }

    /// Loads `file` paused at its start, playing `item`'s trim, speed, and pitch. `keepLoop`
    /// keeps Repeat on through a new file of the same recording.
    private func start(_ file: RecordingAudioFile, _ item: PlayerItem, keepLoop: Bool = false) {
        audio.load(file.url, nowPlaying: nowPlaying(for: item), keepLoop: keepLoop)
        loadedFile = (file, audio.duration)
        applied = [:]
        recordingAudio = .loaded
        guard let row = item.recording else { return }
        if let window = window(row) { audio.setWindow(window) }
        for setting in PlaybackSetting.allCases { apply(setting) }
        loops.audioReady(trimStartMs: row.trimStartMs)
    }

    /// The queue's own title while one drives the player, otherwise `item`'s.
    private func nowPlaying(for item: PlayerItem) -> NowPlaying {
        queuedNowPlaying ?? NowPlaying(title: item.title, tuneTitle: item.tuneTitle)
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

    /// Plays a just-loaded link: through MusicKit when it can, otherwise in its embed, in full.
    /// `autoplay` false leaves a MusicKit track paused at its start, `asksAccess` false plays the
    /// embed rather than show the access prompt, and `expandsOnFallBack` false leaves the player
    /// as it is shown when the embed plays instead.
    private func startLink(
        _ item: PlayerItem, autoplay: Bool = true, asksAccess: Bool = true, expandsOnFallBack: Bool = true
    ) {
        guard let kind = item.link?.appleMusic, let appleMusic else {
            linkAudio = .embed
            isExpanded = item.link != nil
            return
        }
        let expands = expandsOnFallBack
        decide(
            item, kind: kind, appleMusic: appleMusic, queued: false, autoplay: autoplay, asksAccess: asksAccess
        ) { [weak self] emptyingQueue in
            self?.fallBack(emptyingQueue: emptyingQueue, expanding: expands)
        }
    }

    /// Finds, loads, and starts the Apple Music song `kind` for the link `item` through MusicKit,
    /// handing every outcome that cannot play it to `fail`, which takes whether the load left a
    /// queue to empty. `queued` plays it guarded, yielding the audio session first and never
    /// prompting for access; `autoplay` false leaves it paused at its start.
    private func decide(
        _ item: PlayerItem, kind: AppleMusicKind, appleMusic: AppleMusic, queued: Bool, autoplay: Bool,
        asksAccess: Bool, fail: @escaping @MainActor (_ emptyingQueue: Bool) -> Void
    ) {
        linkAudio = .deciding
        if !queued { isExpanded = false }
        let id = item.id
        startDeadline(id) { fail(true) }
        deciding = Task { [weak self] in
            var access = await appleMusic.access.current()
            guard let self, isDeciding(id) else { return }
            if access == .notAsked && asksAccess {
                deadline?.cancel()
                analytics.appleMusicAnswered(await appleMusic.access.request())
                guard isDeciding(id) else { return }
                startDeadline(id) { fail(true) }
                // Read again under the deadline: the subscription lookup needs the network.
                access = await appleMusic.access.current()
                guard isDeciding(id) else { return }
            }
            guard access == .fullTracks else {
                fail(false)
                return
            }
            if queued { audio.yieldSessionToMusic() }
            guard await appleMusic.player.load(kind, guarded: queued), isDeciding(id) else {
                guard isDeciding(id) else { return }
                fail(true)
                return
            }
            guard !isCapturing() else {
                // A queue left behind would answer the headphones' play button during the take.
                close()
                return
            }
            // The queue left while the song loaded, so nothing watches this guard queue to play it.
            let abandoned = queued && queue == nil
            if autoplay && !abandoned {
                guard await appleMusic.player.start(), isDeciding(id) else {
                    guard isDeciding(id) else {
                        // A start that lands after the deadline or a close would play under the
                        // embed, or with no player shown, unless another link now owns MusicKit.
                        if linkAudio != .native && linkAudio != .deciding { appleMusic.player.stop() }
                        return
                    }
                    fail(true)
                    return
                }
            }
            finishDeciding()
            linkAudio = .native
            loadedGuarded = queued
            // The queue may have left while the song loaded.
            releaseGuard()
        }
    }

    /// Whether the decision for link `id` still stands: not cancelled, and the link still loaded.
    private func isDeciding(_ id: String) -> Bool {
        !Task.isCancelled && holds(.link, id: id) && linkAudio == .deciding
    }

    /// Runs `onTimeout` if link `id` is still being decided once the decision timeout passes.
    private func startDeadline(_ id: String, onTimeout: @escaping @MainActor () -> Void) {
        deadline?.cancel()
        let timeout = decisionTimeout
        deadline = Task { [weak self] in
            try? await Task.sleep(for: timeout)
            guard let self, isDeciding(id) else { return }
            onTimeout()
        }
    }

    /// Plays a queued Apple Music song through MusicKit, guarded so its own next and previous
    /// report to the queue. Never asks for access and never plays the embed: a song that
    /// cannot play here goes back to the queue.
    private func startQueuedSong(_ item: PlayerItem, autoplay: Bool = true) {
        guard case .song? = item.link?.appleMusic, let kind = item.link?.appleMusic, let appleMusic else {
            queuedItemCannotPlay()
            return
        }
        decide(item, kind: kind, appleMusic: appleMusic, queued: true, autoplay: autoplay, asksAccess: false) {
            [weak self] emptyingQueue in
            guard let self else { return }
            if queue != nil {
                queuedItemCannotPlay()
            } else {
                // The queue left mid-decision, so this is a single song again.
                fallBack(emptyingQueue: emptyingQueue, expanding: false)
            }
        }
    }

    /// Lets go of a loaded item whose row is gone: a queue moves on to its next track, and
    /// otherwise the player closes.
    private func dropGoneItem() {
        if queuedNowPlaying != nil {
            queuedItemCannotPlay()
        } else {
            close()
        }
    }

    /// Closes the queued item, which cannot play here, and tells the queue. The queue stays
    /// attached, with its session held, for the track it picks next, which the player shows as
    /// it was: in full or not.
    private func queuedItemCannotPlay() {
        unloadItem(keepsExpansion: queue != nil)
        queue?.playerCouldNotPlay()
    }

    /// Ends the decision with the link's embed, in full unless `expanding` is false.
    /// `emptyingQueue` clears whatever a load left in the MusicKit queue; a decision that never
    /// loaded has nothing to clear.
    private func fallBack(emptyingQueue: Bool = true, expanding: Bool) {
        finishDeciding()
        if emptyingQueue { appleMusic?.player.stop() }
        linkAudio = .embed
        guard expanding else { return }
        expandedWindow = nil
        isExpanded = true
    }

    private func finishDeciding() {
        deciding?.cancel()
        deciding = nil
        deadline?.cancel()
        deadline = nil
    }

    private func stopAudio() {
        flushSettings()
        fetch?.cancel()
        fetch = nil
        finishDeciding()
        if linkAudio == .native || linkAudio == .deciding { appleMusic?.player.stop() }
        linkAudio = nil
        loadedGuarded = false
        releasing?.cancel()
        releasing = nil
        if recordingAudio == .loaded { audio.unload() }
        recordingAudio = nil
        loadedFile = nil
        applied = [:]
        edits = [:]
        held = [:]
        failure = nil
    }
}
