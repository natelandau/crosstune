import CrosstuneStore
import MapKit
import SwiftUI

/// A small map image of a spot: a pin for a precise point, or a circle as wide as the fix's
/// accuracy for a loose one. The snapshotter draws no overlays, so the pin or circle is drawn
/// over the image.
struct LocationThumbnail: View {
    let coordinate: Coordinate
    let accuracyM: Int?

    static let side: CGFloat = 48

    /// What shows while the snapshot draws: the Mac's field fill, the system's quaternary fill
    /// elsewhere.
    private static var placeholder: AnyShapeStyle {
        #if os(macOS)
            AnyShapeStyle(Palette.field)
        #else
            AnyShapeStyle(Palette.border)
        #endif
    }
    /// The least ground the thumbnail spans, as the location page's map does.
    private static let minimumSpanM = 400.0

    @Environment(\.colorScheme) private var colorScheme
    @State private var image: Image?

    static func spanM(accuracyM: Int?) -> Double {
        max(minimumSpanM, Double(accuracyM ?? 0) * 3)
    }

    private var key: LocationSnapshotKey {
        LocationSnapshotKey(
            coordinate: coordinate, spanM: Self.spanM(accuracyM: accuracyM), isDark: colorScheme == .dark)
    }

    var body: some View {
        ZStack {
            Rectangle().fill(Self.placeholder)
            if let image { image.resizable().scaledToFill() }
            mark
        }
        .frame(width: Self.side, height: Self.side)
        .clipShape(.rect(cornerRadius: 8))
        .contentMask()
        // The row's text names the spot.
        .accessibilityHidden(true)
        .task(id: key) { image = await LocationSnapshotCache.shared.image(for: key) }
    }

    @ViewBuilder private var mark: some View {
        if PlaceDistances.isPrecise(accuracyM: accuracyM) {
            Image(systemName: "pin.circle.fill")
                .font(.platform(.title3))
                .foregroundStyle(Palette.danger, Palette.onStatus)
                // The thumbnail keeps its size, so the pin does too.
                .dynamicTypeSize(...DynamicTypeSize.large)
        } else if let accuracyM {
            let diameter = Self.side * 2 * Double(accuracyM) / Self.spanM(accuracyM: accuracyM)
            Circle()
                .fill(Palette.tint(colorScheme))
                .stroke(.tint, lineWidth: 1)
                .frame(width: diameter, height: diameter)
        }
    }
}

/// What a snapshot is cached by: the point rounded to about a meter, and the look it was drawn in.
struct LocationSnapshotKey: Hashable, Sendable {
    let lat: Double
    let lon: Double
    let spanM: Double
    let isDark: Bool

    init(coordinate: Coordinate, spanM: Double, isDark: Bool) {
        lat = (coordinate.lat * 100_000).rounded() / 100_000
        lon = (coordinate.lon * 100_000).rounded() / 100_000
        self.spanM = spanM
        self.isDark = isDark
    }
}

/// Recent snapshots, kept to a bounded number. A request for a key already being drawn shares
/// that draw, and a failed one is not kept, so the next appearance tries again.
@MainActor
final class LocationSnapshotCache {
    static let shared = LocationSnapshotCache()

    private final class Box {
        let image: Image
        init(_ image: Image) { self.image = image }
    }

    private let images = NSCache<NSString, Box>()
    private var drawing: [LocationSnapshotKey: Task<Image?, Never>] = [:]

    init(limit: Int = 200) {
        images.countLimit = limit
    }

    func image(for key: LocationSnapshotKey) async -> Image? {
        let name = "\(key.lat),\(key.lon),\(key.spanM),\(key.isDark)" as NSString
        if let cached = images.object(forKey: name) { return cached.image }
        if let inFlight = drawing[key] { return await inFlight.value }
        let task = Task { await Self.snapshot(key) }
        drawing[key] = task
        let image = await task.value
        drawing[key] = nil
        if let image { images.setObject(Box(image), forKey: name) }
        return image
    }

    private static func snapshot(_ key: LocationSnapshotKey) async -> Image? {
        let options = MKMapSnapshotter.Options()
        options.region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: key.lat, longitude: key.lon),
            latitudinalMeters: key.spanM, longitudinalMeters: key.spanM)
        options.size = CGSize(width: LocationThumbnail.side, height: LocationThumbnail.side)
        #if os(macOS)
            options.appearance = NSAppearance(named: key.isDark ? .darkAqua : .aqua)
        #else
            options.traitCollection = UITraitCollection(userInterfaceStyle: key.isDark ? .dark : .light)
        #endif
        guard let snapshot = try? await MKMapSnapshotter(options: options).start() else { return nil }
        #if os(macOS)
            return Image(nsImage: snapshot.image)
        #else
            return Image(uiImage: snapshot.image)
        #endif
    }
}
