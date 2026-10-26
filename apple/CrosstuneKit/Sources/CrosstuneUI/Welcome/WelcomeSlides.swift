import CrosstuneAnalytics
import CrosstuneAudio
import SwiftUI

/// The welcome carousel's slides, in the order they show.
enum WelcomeSlide: CaseIterable, Identifiable, Comparable {
    case intro
    case catalog
    case record
    case practice
    case listen
    case tuner

    var id: Self { self }

    func headline(for device: WelcomeDevice) -> String {
        switch self {
        case .intro: WelcomeCopy.headline(for: device)
        case .catalog: WelcomeCopy.catalogHeadline
        case .record: WelcomeCopy.recordHeadline
        case .practice: WelcomeCopy.practiceHeadline
        case .listen: WelcomeCopy.listenHeadline
        case .tuner: WelcomeCopy.tunerHeadline
        }
    }

    var name: WelcomeSlideName {
        switch self {
        case .intro: .intro
        case .catalog: .catalog
        case .record: .record
        case .practice: .practice
        case .listen: .listen
        case .tuner: .tuner
        }
    }

    /// The slide's place counting from one, as the dots name it.
    var number: Int { Self.allCases.firstIndex(of: self)! + 1 }
}

/// Which slide shows, and the furthest one the player has reached. Moves only when the player
/// moves it.
struct WelcomeCarousel: Equatable {
    private(set) var current: WelcomeSlide = .intro
    private(set) var furthest: WelcomeSlide = .intro

    mutating func show(_ slide: WelcomeSlide) {
        current = slide
        furthest = max(furthest, slide)
    }

    /// Stays on the last slide rather than wrap to the first.
    mutating func next() {
        let slides = WelcomeSlide.allCases
        guard let index = slides.firstIndex(of: current), index + 1 < slides.count else { return }
        show(slides[index + 1])
    }

    /// Stays on the first slide rather than wrap to the last.
    mutating func previous() {
        let slides = WelcomeSlide.allCases
        guard let index = slides.firstIndex(of: current), index > 0 else { return }
        show(slides[index - 1])
    }
}

// MARK: - The drawings

/// The slide drawings are laid out at `baseUnit` and scaled to `unit`, so the key pills and
/// chips inside keep the drawing's proportions at every size, and each fills the same box as
/// `WelcomeIllustration` so the headline under it never moves between slides.
private let baseUnit: CGFloat = 12

extension View {
    /// `fill` enlarges a drawing laid out smaller than the box, so every slide fills its stage alike.
    fileprivate func slideArt(unit: CGFloat, fill: CGFloat = 1) -> some View {
        scaleEffect(fill)
            .frame(width: 22.4 * baseUnit, height: 17 * baseUnit)
            .scaleEffect(unit / baseUnit, anchor: .topLeading)
            .frame(width: 22.4 * unit, height: 17 * unit, alignment: .topLeading)
            // Pinned so the key pills inside keep the drawing's proportions at every text size.
            .dynamicTypeSize(.large)
            .accessibilityHidden(true)
    }
}

/// A card lifted off the page, as the slides' cards and chips sit.
private struct SlideCard: ViewModifier {
    var radius: CGFloat = 12
    var shadow = true

    func body(content: Content) -> some View {
        content
            .background(Palette.raised, in: .rect(cornerRadius: radius))
            .overlay { RoundedRectangle(cornerRadius: radius).strokeBorder(Palette.hairline) }
            .shadow(color: .black.opacity(shadow ? 0.08 : 0), radius: 6, y: 3)
    }
}

/// A short label on a card, as a chip in the app shows a setting.
private struct SlideChip: View {
    let text: String
    var size: CGFloat = 11

    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(Palette.ink)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, size * 9 / 11)
            .padding(.vertical, size * 4 / 11)
            .modifier(SlideCard(radius: size * 8 / 11, shadow: false))
    }
}

/// A part of the catalog under its key filter, one tune of each status. Decorative: the
/// headline says the same thing in words.
struct CatalogSlideArt: View {
    var unit: CGFloat = baseUnit

    private static let tunes: [(tune: String, status: String)] = [
        ("Soldier's Joy", "known"),
        ("Forked Deer", "known"),
        ("Bonaparte's Retreat", "learning"),
        ("Ways of the World", "want_to_learn"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                KeyPill("A", size: .compact)
                KeyPill("D", size: .compact, chosen: true)
                KeyPill("G", size: .compact)
                KeyPill("C", size: .compact)
            }
            .padding(.bottom, 8)
            ForEach(Self.tunes.enumerated(), id: \.offset) { index, row in
                HStack(spacing: 8) {
                    dot(row.status)
                    Text(row.tune)
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                }
                .padding(.vertical, 5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .bottom) {
                    if index < Self.tunes.count - 1 {
                        Rectangle().fill(Palette.hairline).frame(height: 1)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(width: 210)
        .modifier(SlideCard())
        .slideArt(unit: unit, fill: 1.25)
    }

    @ViewBuilder private func dot(_ status: String) -> some View {
        switch StatusStyle.dot(status) {
        case .filled(let color):
            Circle().fill(color).frame(width: 9, height: 9)
        case .ring:
            Circle().strokeBorder(StatusStyle.unknown, lineWidth: 1.5).frame(width: 9, height: 9)
        }
    }
}

/// Bar heights, as shares of the waveform's height, for the slides' recordings.
private let recordedLevels: [CGFloat] = [0.3, 0.7, 0.5, 0.9, 0.6, 0.8, 0.4, 0.75, 0.55, 0.85, 0.35, 0.65]

/// The record control with a recording's waveform over it and the tune it is filed under.
/// Decorative: the headline says the same thing in words.
struct RecordSlideArt: View {
    var unit: CGFloat = baseUnit

    /// Twice the slides' levels, so the waveform spans the drawing as the other slides do.
    private static let levels = recordedLevels + recordedLevels.reversed()

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 4) {
                ForEach(Self.levels.enumerated(), id: \.offset) { _, level in
                    Capsule()
                        .fill(Color.recordingRed)
                        .frame(width: 5, height: 60 * level)
                }
            }
            .frame(height: 60)
            ZStack {
                Circle().strokeBorder(Palette.ink, lineWidth: 5)
                RoundedRectangle(cornerRadius: 7)
                    .fill(Color.recordingRed)
                    .frame(width: 27, height: 27)
            }
            .frame(width: 72, height: 72)
            SlideChip(text: "Filed under Sally Goodin", size: 14)
        }
        .slideArt(unit: unit)
    }
}

/// A recording's waveform with a named loop over its hard part, and the practice settings
/// that slow it down. Decorative: the headline says the same thing in words.
struct PracticeSlideArt: View {
    var unit: CGFloat = baseUnit

    @Environment(\.colorScheme) private var colorScheme

    private static let levels = recordedLevels + recordedLevels.reversed() + recordedLevels
    /// Where the loop starts and how much of the waveform it spans.
    private static let loopStart = 0.44
    private static let loopShare = 0.3
    private static let loopSlot = 1
    private static let width: CGFloat = 220
    private static let height: CGFloat = 50

    var body: some View {
        let loop = LoopColor.color(Self.loopSlot, scheme: colorScheme)
        VStack(spacing: 16) {
            HStack(spacing: 2) {
                ForEach(Self.levels.enumerated(), id: \.offset) { _, level in
                    Capsule()
                        .fill(Palette.inkSecondary.opacity(0.5))
                        .frame(height: Self.height * level)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(width: Self.width, height: Self.height)
            .overlay(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(LoopColor.tint(Self.loopSlot, scheme: colorScheme))
                    .overlay(alignment: .leading) { Rectangle().fill(loop).frame(width: 2) }
                    .overlay(alignment: .trailing) { Rectangle().fill(loop).frame(width: 2) }
                    .frame(width: Self.width * Self.loopShare, height: Self.height + 12)
                    .offset(x: Self.width * Self.loopStart, y: -6)
            }
            .overlay(alignment: .topLeading) {
                Text("Tricky turn, B part")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(loop)
                    .lineLimit(1)
                    .fixedSize()
                    .offset(x: Self.width * Self.loopStart, y: -22)
            }
            .padding(.top, 22)
            HStack(spacing: 8) {
                SlideChip(text: "Speed 75%")
                SlideChip(text: "Pitch +1")
                SlideChip(text: "Loop on")
            }
        }
        .slideArt(unit: unit, fill: 1.2)
    }
}

/// Tunes playing from the services they are linked on, the first playing in the app. Each row
/// names its service in words, since the app carries no service logos. Decorative: the
/// headline says the same thing in words.
struct ListenSlideArt: View {
    var unit: CGFloat = baseUnit

    private static let recordings: [(tune: String, provider: String)] = [
        ("Last Chance", "spotify"),
        ("Half Past Four", "youtube"),
        ("June Apple", "apple_music"),
    ]

    // The Mac's rows are set smaller, so its card draws narrower and scales up to the same box.
    #if os(macOS)
        private static let width: CGFloat = 196
        private static let fill: CGFloat = 1.3
    #else
        private static let width: CGFloat = 236
        private static let fill: CGFloat = 1
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Self.recordings.enumerated(), id: \.offset) { index, row in
                MediaRow(
                    glyph: index == 0 ? .stop : .play, title: row.tune,
                    secondLine: .text(LinkText.providerLabel(row.provider))
                )
                .padding(.vertical, 2)
                .overlay(alignment: .bottom) {
                    if index < Self.recordings.count - 1 {
                        Rectangle().fill(Palette.hairline).frame(height: 1)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(width: Self.width, alignment: .leading)
        .modifier(SlideCard())
        .allowsHitTesting(false)
        .slideArt(unit: unit, fill: Self.fill)
    }
}

/// The Tuner screen's stage reading an A a little sharp: its own bars, note, and readout on
/// the jet ground the tuner always draws on. Decorative: the headline says the same thing in
/// words.
struct TunerSlideArt: View {
    var unit: CGFloat = baseUnit

    @Environment(\.colorScheme) private var colorScheme

    /// Inside the target zone but past in tune, so the bars lean toward green and the hint
    /// still shows.
    private static let cents = 6.0
    /// A unit short of the drawing's box, as the web's tuner slide draws it.
    private static let stageHeight: CGFloat = 16 * baseUnit
    /// The note, octave, readout, and hint type, in the web's tuner slide's sizes.
    private static let noteSize: CGFloat = 56
    private static let octaveSize: CGFloat = 20
    private static let readoutSize: CGFloat = 15
    private static let hintSize: CGFloat = 12

    var body: some View {
        let ground = PhoneStyle.tuneGroundHex(colorScheme, green: inTuneFraction(cents: Self.cents))
        ZStack {
            TunerBars(cents: Self.cents, animation: nil)
            VStack(spacing: 0) {
                Color.clear.frame(maxHeight: .infinity)
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text(NoteName.a.rawValue)
                        .font(.system(size: Self.noteSize, weight: .light))
                    Text("4")
                        .font(.system(size: Self.octaveSize, weight: .light))
                }
                VStack(spacing: 4) {
                    Text(TunerText.centsLabel(Self.cents))
                        .font(.system(size: Self.readoutSize, weight: .semibold).monospacedDigit())
                    if let hint = TunerText.hintLabel(cents: Self.cents) {
                        Text(hint)
                            .font(.system(size: Self.hintSize))
                            .foregroundStyle(PhoneStyle.tuneMuted)
                    }
                }
                .padding(.top, 4)
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(width: 22.4 * baseUnit, height: Self.stageHeight)
        .background(BrandStyle.color(hex: ground), in: .rect(cornerRadius: 16))
        .clipShape(.rect(cornerRadius: 16))
        .environment(\.colorScheme, .dark)
        .slideArt(unit: unit)
    }
}

#Preview("Slides, light") {
    slidePreview.preferredColorScheme(.light)
}

#Preview("Slides, dark") {
    slidePreview.preferredColorScheme(.dark)
}

// periphery:ignore - read by the slide previews
@MainActor private var slidePreview: some View {
    ScrollView {
        VStack(spacing: 24) {
            CatalogSlideArt()
            RecordSlideArt()
            PracticeSlideArt()
            ListenSlideArt()
            TunerSlideArt()
        }
        .padding()
    }
    .background(Palette.ground)
}
