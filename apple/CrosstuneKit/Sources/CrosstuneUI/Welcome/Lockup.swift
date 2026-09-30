import SwiftUI

/// The bare CT mark, cropped to its cap height. The C takes the foreground style so it follows
/// the surface; the T is coral on every surface. Drawn in the artwork's own 434 by 304 units.
struct Mark: View {
    static let coral = Color(.sRGB, red: 0xEF / 255, green: 0x83 / 255, blue: 0x54 / 255)
    static let aspect: CGFloat = 434 / 304

    var body: some View {
        Canvas { context, size in
            let scale = size.height / 304
            context.scaleBy(x: scale, y: scale)
            context.translateBy(x: -39, y: -104)
            let style = StrokeStyle(lineWidth: 68, lineCap: .round)
            var tee = Path()
            tee.move(to: CGPoint(x: 191, y: 138))
            tee.addLine(to: CGPoint(x: 439, y: 138))
            tee.move(to: CGPoint(x: 339, y: 138))
            tee.addLine(to: CGPoint(x: 339, y: 374))
            context.stroke(tee, with: .color(Self.coral), style: style)
            // The artwork's arc from (231, 367) round the left to (191, 138), radius 118.
            var cee = Path()
            cee.addArc(
                center: CGPoint(x: 190.95, y: 256), radius: 118,
                startAngle: .degrees(70.16), endAngle: .degrees(270), clockwise: false)
            context.stroke(cee, with: .foreground, style: style)
            context.fill(Path(CGRect(x: 191, y: 104, width: 48, height: 68)), with: .foreground)
        }
        .aspectRatio(Self.aspect, contentMode: .fit)
    }
}

/// The mark beside the name, sized to the headline text style.
struct Lockup: View {
    @ScaledMetric(relativeTo: .headline) private var capHeight: CGFloat = Self.headlineCapHeight

    // The platform's own cap height for the headline style at its default size.
    private static var headlineCapHeight: CGFloat {
        #if os(macOS)
            NSFont.preferredFont(forTextStyle: .headline).capHeight
        #else
            UIFont.preferredFont(
                forTextStyle: .headline,
                compatibleWith: UITraitCollection(preferredContentSizeCategory: .large)
            ).capHeight
        #endif
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: capHeight * 0.4) {
            Mark()
                .frame(height: capHeight)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] }
                .accessibilityHidden(true)
            Text("Crosstune")
        }
        .font(.headline)
    }
}
