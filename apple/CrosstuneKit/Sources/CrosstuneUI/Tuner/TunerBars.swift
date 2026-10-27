import CrosstuneAudio
import CrosstuneDesign
import SwiftUI

/// A slab at each side edge, level with the note when in tune, risen when sharp and sunk when
/// flat, over a target zone that spans the in-zone cents. The brand color far off, the lighter
/// close step just outside the zone, and turning green inside it as the note nears in tune.
struct TunerBars: View {
    let cents: Double
    let animation: Animation?

    /// The furthest a bar travels, in cents and as a share of the stage's height.
    static let fullCents = 50.0
    static let fullTravel = 0.4
    /// The target zone's height as a share of the stage's: its cents either way, on the bars' scale.
    static let zoneHeight = 2 * zoneCents / fullCents * fullTravel
    /// Each slab's width as a share of the stage's.
    static let barShare = 0.2
    /// Half the note's widest glyph, which a slab on a narrow stage stops short of.
    static let noteClearance: CGFloat = 96
    /// The widest a slab grows on a wide stage.
    static let maxBarWidth: CGFloat = 160
    /// Each slab's height as a share of the stage's, and the least it ever is.
    static let barHeightShare = 0.04
    static let minBarHeight: CGFloat = 8
    static let barRadius: CGFloat = 6
    static let zoneRadius: CGFloat = 12
    static let glowRadius: CGFloat = 6

    /// How far a bar sits from level for `cents` on a stage `height` tall: up, so negative, when
    /// sharp, and never past ``fullCents``.
    static func barOffset(cents: Double, height: CGFloat) -> CGFloat {
        let clamped = min(fullCents, max(-fullCents, cents))
        return -(clamped / fullCents) * (fullTravel * height)
    }

    /// Each slab's width on a stage `width` wide.
    static func barWidth(stageWidth width: CGFloat) -> CGFloat {
        max(0, min(width * barShare, width / 2 - noteClearance, maxBarWidth))
    }

    var body: some View {
        let green = inTuneFraction(cents: cents)
        let color = Palette.color(hex: Palette.tunerBarHex(cents: cents))
        GeometryReader { proxy in
            let size = proxy.size
            let width = Self.barWidth(stageWidth: size.width)
            HStack(spacing: 0) {
                side(inner: .trailing, size: size, width: width, color: color, green: green)
                Spacer(minLength: 0)
                side(inner: .leading, size: size, width: width, color: color, green: green)
            }
            .frame(width: size.width, height: size.height)
        }
        .animation(animation, value: cents)
        .accessibilityHidden(true)
    }

    private func side(inner: HorizontalEdge, size: CGSize, width: CGFloat, color: Color, green: Double) -> some View {
        ZStack {
            Self.innerRounded(inner, radius: Self.zoneRadius)
                .fill(Palette.tunerZone(green: green))
                .frame(height: size.height * Self.zoneHeight)
            Self.innerRounded(inner, radius: Self.barRadius)
                .fill(color)
                .frame(height: max(Self.minBarHeight, size.height * Self.barHeightShare))
                .shadow(color: Palette.tunerGlow(color), radius: Self.glowRadius)
                .offset(y: Self.barOffset(cents: cents, height: size.height))
        }
        .frame(width: width, height: size.height)
    }

    /// A rectangle rounded only on its `inner` side, so it sits flush against the stage's edge.
    private static func innerRounded(_ inner: HorizontalEdge, radius: CGFloat) -> UnevenRoundedRectangle {
        inner == .trailing
            ? UnevenRoundedRectangle(bottomTrailingRadius: radius, topTrailingRadius: radius)
            : UnevenRoundedRectangle(topLeadingRadius: radius, bottomLeadingRadius: radius)
    }
}

extension Palette {
    /// The tuner's bars for a note `cents` off, on the tuner's own steps.
    static func tunerBarHex(cents: Double) -> String {
        switch tuneStep(cents: cents) {
        case .far: tunerBarHex(.far)
        case .close: tunerBarHex(.close)
        case .zone: tunerBarHex(.zone(inTune: inTuneFraction(cents: cents)))
        }
    }
}
