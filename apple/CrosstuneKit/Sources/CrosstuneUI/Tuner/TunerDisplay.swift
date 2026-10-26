import CrosstuneAudio
import SwiftUI

/// The newest reading, held until the next one replaces it, since a plucked string decays before
/// the player looks up, and the announcer that speaks it. The screen owns it but never reads it in
/// its body, so a reading redraws only the views that show one.
@MainActor
@Observable
final class TunerLastReading {
    var last: Reading?
    var announcer = TunerAnnouncer()

    /// Forgets the reading and the announcements, so the next session starts with the prompt.
    func forget() {
        last = nil
        announcer = TunerAnnouncer()
    }

    /// The reading to show: the live one, else the last one, and none unless listening.
    func shown(_ model: TunerModel?) -> Reading? {
        guard let model, model.status == .listening else { return nil }
        return model.reading ?? last
    }
}

/// The ground behind the tuner, greening as the shown note comes into tune.
struct TunerGround: View {
    let model: TunerModel?
    let lastReading: TunerLastReading
    /// The screen's own appearance, not the dark one its content takes.
    let colorScheme: ColorScheme
    let motion: Animation?

    var body: some View {
        let green = lastReading.shown(model).map { inTuneFraction(cents: $0.note.cents) } ?? 0
        BrandStyle.color(hex: PhoneStyle.tuneGroundHex(colorScheme, green: green))
            .ignoresSafeArea()
            .animation(motion, value: green)
    }
}

/// The tuner's display: the bars and the note heard, the prompt while nothing is, or why it cannot
/// listen.
struct TunerDisplay: View {
    let model: TunerModel?
    let lastReading: TunerLastReading
    let motion: Animation?

    @Environment(\.openURL) private var openURL
    @Environment(\.locale) private var locale

    private var status: TunerModel.Status { model?.status ?? .idle }

    private var reading: Reading? { status == .listening ? model?.reading : nil }

    var body: some View {
        ZStack {
            switch status {
            case .denied:
                message(heading: TunerText.micDeniedTitle, body: TunerText.micDeniedBody, opensSettings: true)
            case .unavailable:
                message(heading: nil, body: TunerText.micUnavailable, opensSettings: false)
            case .idle:
                EmptyView()
            case .listening:
                if let shown = lastReading.shown(model) {
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
        .onChange(of: reading) {
            guard let reading else { return }
            lastReading.last = reading
            if let words = lastReading.announcer.next(reading) {
                AccessibilityNotification.Announcement(words).post()
            }
        }
    }

    /// The note on the display's middle, level with in-tune bars, and the cents hanging below it.
    private func readout(_ shown: Reading) -> some View {
        let note = shown.note
        return VStack(spacing: 0) {
            Color.clear.frame(maxHeight: .infinity)
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(note.name.rawValue)
                    .font(.system(size: TunerScreen.noteSize, weight: .light))
                Text(String(note.octave))
                    .font(.system(size: TunerScreen.octaveSize, weight: .light))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            VStack(spacing: 8) {
                Text(TunerText.centsLabel(note.cents, locale: locale))
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
