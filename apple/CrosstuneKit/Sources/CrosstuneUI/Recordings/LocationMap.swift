import CoreLocation
import CrosstuneDesign
import CrosstuneStore
import MapKit
import SwiftUI

/// A small still map of a recording's spot: a pin for a precise point, or a circle as wide as
/// the fix's accuracy for a loose one. Apple's terms want an Apple map wherever an Apple address
/// or venue shows, so the location page always draws one for a point.
struct LocationMap: View {
    let coordinate: Coordinate
    let accuracyM: Int?

    private static let height: CGFloat = 180

    @Environment(\.colorScheme) private var colorScheme
    /// The least ground the map spans, so a pin shows its streets around it.
    private static let minimumSpanM = 400.0

    private var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: coordinate.lat, longitude: coordinate.lon)
    }

    private var region: MKCoordinateRegion {
        let span = max(Self.minimumSpanM, Double(accuracyM ?? 0) * 3)
        return MKCoordinateRegion(center: center, latitudinalMeters: span, longitudinalMeters: span)
    }

    var body: some View {
        Map(initialPosition: .region(region), interactionModes: []) {
            if PlaceDistances.isPrecise(accuracyM: accuracyM) {
                Marker("", coordinate: center)
            } else if let accuracyM {
                MapCircle(center: center, radius: Double(accuracyM))
                    .foregroundStyle(Palette.tint(colorScheme))
                    .stroke(.tint, lineWidth: 1)
            }
        }
        .contentMask()
        // The camera is set only when the map is made, so a new point makes a new map.
        .id(coordinate)
        .frame(height: Self.height)
        // The Current section below names the spot in words.
        .accessibilityHidden(true)
    }
}

/// Opens Apple Maps at `coordinate`, labeled with `name` when there is one.
@MainActor
func openInMaps(name: String?, coordinate: Coordinate) {
    let item = MKMapItem(location: CLLocation(latitude: coordinate.lat, longitude: coordinate.lon), address: nil)
    item.name = name
    _ = item.openInMaps(launchOptions: nil)
}
