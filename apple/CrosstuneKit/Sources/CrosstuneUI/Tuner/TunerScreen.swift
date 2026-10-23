import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import SwiftUI

extension EnvironmentValues {
    /// Whether the Tuner is the window's chosen tab or sidebar row. Supplied by the shell; false
    /// outside it, where the tuner never listens.
    @Entry var tunerSelected = false
}

/// What decides whether the tuner listens, so a change to any of them reaches the model.
private struct TunerLifecycle: Equatable {
    var shown: Bool
    var foreground: Bool
    var covered: Bool
    var capturing: Bool
    var playing: Bool
    /// Nil until the settings load, and while this window does not want to listen.
    var a4: Int?
}

/// The Tuner destination: the note heard, how far off it is, and a bar at each side, on the
/// practice ground in every appearance.
struct TunerScreen: View {
    static let noteSize: CGFloat = 112
    static let octaveSize: CGFloat = 40
    /// How long the bars slide and recolor, and the wash cross-fades.
    static let change = Animation.easeInOut(duration: 0.15)

    @Environment(TunerModel.self) private var model: TunerModel?
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.store) private var store
    @Environment(\.tunerSelected) private var selected
    @Environment(\.openSheets) private var openSheets
    @Environment(\.recordCover) private var recordCover
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    /// This window's claim on the app's one tuner.
    @State private var client = UUID()
    @State private var appeared = false
    #if os(macOS)
        @State private var windowVisible = false
    #endif
    @State private var settings: LiveQuery<SettingsSummaries?>?
    /// The newest reading, held until the next one replaces it, since a plucked string decays
    /// before the player looks up. Forgotten once listening stops, so the next session starts with
    /// the prompt.
    @State private var last: Reading?
    @State private var announcer = TunerAnnouncer()

    /// The account's reference pitch, nil until its settings load.
    private var loadedA4: Int? {
        (settings?.value ?? nil)?.tunerA4Hz
    }

    private var a4: Int { loadedA4 ?? UserSettings.defaultTunerA4Hz }

    private var foreground: Bool {
        #if os(macOS)
            windowVisible
        #else
            Self.listens(in: scenePhase)
        #endif
    }

    /// Whether a scene at `phase` is foreground for the tuner. An inactive scene, as behind a
    /// passing notification or Control Center, is still on screen.
    static func listens(in phase: ScenePhase) -> Bool {
        phase != .background
    }

    private var covered: Bool {
        (openSheets?.isCovered ?? false) || (recordCover?.isCovered ?? false)
    }

    /// Whether the player plays, or holds an embed that can, in any window.
    private var playing: Bool {
        (player?.transport?.isPlaying ?? false) || player?.embed != nil
    }

    private var lifecycle: TunerLifecycle {
        let shown = appeared && selected
        return TunerLifecycle(
            shown: shown, foreground: foreground, covered: covered,
            capturing: recorders?.isCapturing ?? false, playing: playing,
            a4: shown && foreground && !covered ? loadedA4 : nil)
    }

    private var status: TunerModel.Status { model?.status ?? .idle }

    private var reading: Reading? { status == .listening ? model?.reading : nil }

    private var shown: Reading? { status == .listening ? reading ?? last : nil }

    /// How far the shown note has come toward in tune, which greens the bars and the ground.
    private var green: Double {
        shown.map { greenness(cents: $0.note.cents) } ?? 0
    }

    private var motion: Animation? { reduceMotion ? nil : Self.change }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            #if os(macOS)
                Text(Destination.tunerTitle)
                    .font(MacStyle.columnTitle)
                    .tracking(MacStyle.columnTitleTracking)
                    .columnTitleBaseline(.page)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.horizontal, PageStyle.pageMargin)
            #endif
            if let reference = TunerText.referenceLabel(a4) {
                Text(reference)
                    .font(PageStyle.secondary)
                    .foregroundStyle(PhoneStyle.tuneMuted)
                    .padding(.horizontal, PageStyle.pageMargin)
            }
            stage
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .environment(\.colorScheme, .dark)
        .background {
            BrandStyle.color(hex: PhoneStyle.tuneGroundHex(colorScheme, green: green))
                .ignoresSafeArea()
                .animation(motion, value: green)
        }
        // A visited tab stays alive behind the selected one, so being on screen is not enough.
        .modifier(KeepsScreenAwake(active: lifecycle.shown && lifecycle.foreground && !covered))
        #if os(macOS)
            .windowVisibility { windowVisible = $0 }
            .navigationTitle(Destination.tunerTitle)
            .toolbar(removing: .title)
        #else
            .navigationTitle(Destination.tunerTitle)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { AccountToolbarItem() }
        #endif
        .screenView(.tuner)
        .task(id: store.map(ObjectIdentifier.init)) {
            settings = store.map { SettingsSummaries.live($0) }
        }
        .onAppear {
            player?.quietForTuner()
            appeared = true
        }
        .onDisappear {
            appeared = false
            last = nil
            announcer = TunerAnnouncer()
            // A disappeared view runs no more changes, so the stop is sent here.
            var gone = lifecycle
            gone.shown = false
            drive(gone)
        }
        .onChange(of: lifecycle, initial: true) {
            // Forgotten here as well as on the model's stop, which arrives a moment later.
            if lifecycle.a4 == nil { last = nil }
            drive(lifecycle)
        }
        // The next session starts fresh, with the prompt and its own announcements.
        .onChange(of: status) {
            if status != .listening {
                last = nil
                announcer = TunerAnnouncer()
            }
        }
        .onChange(of: reading) {
            guard let reading else { return }
            last = reading
            if let words = announcer.next(reading) {
                AccessibilityNotification.Announcement(words).post()
            }
        }
    }

    private func drive(_ lifecycle: TunerLifecycle) {
        guard let model else { return }
        Task {
            await model.update(
                client: client, shown: lifecycle.shown, foreground: lifecycle.foreground, covered: lifecycle.covered,
                playing: lifecycle.playing, a4: lifecycle.a4)
        }
    }

    @ViewBuilder private var stage: some View {
        ZStack {
            switch status {
            case .denied:
                message(heading: TunerText.micDeniedTitle, body: TunerText.micDeniedBody, opensSettings: true)
            case .unavailable:
                message(heading: nil, body: TunerText.micUnavailable, opensSettings: false)
            case .idle:
                EmptyView()
            case .listening:
                if let shown {
                    TunerBars(cents: shown.note.cents, animation: motion)
                    readout(shown)
                } else {
                    Text(TunerText.listening)
                        .font(PageStyle.body)
                        .foregroundStyle(PhoneStyle.tuneMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// The note on the stage's middle, level with in-tune bars, and the cents hanging below it.
    private func readout(_ shown: Reading) -> some View {
        let note = shown.note
        return VStack(spacing: 0) {
            Color.clear.frame(maxHeight: .infinity)
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(note.name.rawValue)
                    .font(.system(size: Self.noteSize, weight: .light))
                Text(String(note.octave))
                    .font(.system(size: Self.octaveSize, weight: .light))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            VStack(spacing: 8) {
                Text(TunerText.centsLabel(note.cents))
                    .font(PageStyle.sectionHeading.monospacedDigit())
                if let hint = TunerText.hintLabel(cents: note.cents) {
                    Text(hint)
                        .font(PageStyle.body)
                        .foregroundStyle(PhoneStyle.tuneMuted)
                }
            }
            .padding(.top, 8)
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(TunerText.spokenReading(note))
    }

    private func message(heading: String?, body: String, opensSettings: Bool) -> some View {
        VStack(spacing: 8) {
            if let heading {
                Text(heading)
                    .font(PageStyle.sectionHeading)
                    .accessibilityAddTraits(.isHeader)
            }
            Text(body)
                .font(PageStyle.body)
                .foregroundStyle(PhoneStyle.tuneMuted)
            if opensSettings, let url = Recorder.settingsURL {
                Button(TunerText.openSettings) { openURL(url) }
                    #if os(macOS)
                        .buttonStyle(.macSecondary)
                    #else
                        .buttonStyle(.bordered)
                    #endif
                    .padding(.top, 8)
            }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
    }
}

extension PlayerModel {
    /// Silences the player as the tuner opens. A recording or an Apple Music song pauses, never
    /// closes, so the queue and the now-playing card stay for the way back, and a song still
    /// being looked up loads paused. An embed closes, since its provider's page offers no pause
    /// the app can reach.
    func quietForTuner() {
        if embed != nil {
            close()
        } else if linkAudio == .deciding {
            holdsAutoplay = true
        } else if let transport, transport.isPlaying {
            transport.pause()
        }
    }
}
