import CrosstuneDesign
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import MapKit
import SwiftUI

/// The words the pin map shows.
public enum DropPinText {
    public static let useThisSpot = "Use this spot"
    public static let hint = "Move the map to place the pin."
}

/// A step inside the location editor: a map with a pin fixed at its center, which the musician
/// moves the map under. Under it, the street address of the spot once the map settles, a Name
/// field for a new saved location, and Use this spot, which hands the spot back to be staged.
/// Back returns with nothing staged.
struct DropPinView: View {
    /// Where the map opens; nil opens on the whole world.
    let start: Coordinate?
    let onUse: (DroppedPin) -> Void
    let onBack: () -> Void
    /// Escape on the Mac, which discards the whole edit as it does in the editor.
    let onCancel: @MainActor () -> Void

    /// How much ground the map shows around its start.
    private static let startSpanM = 600.0

    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @State private var model: DropPinModel?
    @State private var position: MapCameraPosition
    /// The pin's size, which grows with the text size.
    @ScaledMetric(relativeTo: .largeTitle) private var pinSize: CGFloat = 34
    @FocusState private var nameFocused: Bool

    init(
        start: Coordinate?, onUse: @escaping (DroppedPin) -> Void, onBack: @escaping () -> Void,
        onCancel: @escaping @MainActor () -> Void
    ) {
        self.start = start
        self.onUse = onUse
        self.onBack = onBack
        self.onCancel = onCancel
        _position = State(initialValue: Self.position(start))
    }

    private static func position(_ start: Coordinate?) -> MapCameraPosition {
        guard let start else { return .rect(.world) }
        return .region(
            MKCoordinateRegion(
                center: start.clCoordinate,
                latitudinalMeters: startSpanM, longitudinalMeters: startSpanM))
    }

    var body: some View {
        content
            .onAppear {
                guard model == nil else { return }
                let made = DropPinModel(start: start, lookup: ReversePlaceLookup.through(engine))
                model = made
                if let center = made.center { Task { await made.settle(at: center) } }
            }
            .onDisappear { model?.cancel() }
    }

    private func use() {
        guard let pin = model?.pin else { return }
        onUse(pin)
    }

    private var map: some View {
        Map(position: $position)
            .onMapCameraChange(frequency: .onEnd) { context in
                guard let model else { return }
                let center = Coordinate(lat: context.region.center.latitude, lon: context.region.center.longitude)
                let byUser = position.positionedByUser
                Task { await model.settle(at: center, movedByUser: byUser) }
            }
            .overlay {
                Image(systemName: "mappin")
                    .font(.system(size: pinSize))
                    .foregroundStyle(Palette.accent)
                    // The symbol's tip, not its middle, marks the spot.
                    .alignmentGuide(VerticalAlignment.center) { $0[.bottom] }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .contentMask()
    }

    /// The street address under the pin, a spinner while it is looked up, or nothing when there
    /// is none.
    @ViewBuilder private var address: some View {
        if let found = model?.found {
            Text(found.name)
                .contentMask()
        } else if model?.isLookingUp == true {
            ProgressView()
                .controlSize(.small)
        }
    }

    @ViewBuilder private var nameField: some View {
        if let model {
            @Bindable var model = model
            TextField(NameLocationText.nameLabel, text: $model.savedName, prompt: Text(NameLocationText.nameLabel))
                .contentMask()
                #if os(macOS)
                    .labelsHidden()
                    .textFieldStyle(.macField)
                #endif
                .characterLimit(Vocabulary.Limits.Place.name, text: $model.savedName)
                .focused($nameFocused)
                .submitLabel(.done)
                .onSubmit(use)
        }
    }

    #if os(macOS)
        private var content: some View {
            MacSheet(
                title: RecordingPageCopy.location, size: LocationEditor.macSize,
                cancel: .cancel(FindRecordingsSheet.back) { onBack() },
                primary: .init(DropPinText.useThisSpot, isEnabled: model?.pin != nil, isDefault: false) { use() },
                escape: onCancel
            ) {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    map
                        .frame(minHeight: 240, maxHeight: .infinity)
                        .clipShape(.rect(cornerRadius: MacForm.cardRadius))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(DropPinText.hint)
                            .font(MacStyle.secondary)
                            .foregroundStyle(Palette.textSecondary)
                        address
                            .font(MacStyle.body)
                            .foregroundStyle(Palette.textPrimary)
                            .lineLimit(2)
                    }
                    nameField
                }
                .padding(MacStyle.sheetMargin)
            }
        }
    #else
        private var content: some View {
            VStack(spacing: 0) {
                map
                    .ignoresSafeArea(edges: .horizontal)
                VStack(alignment: .leading, spacing: 12) {
                    Text(DropPinText.hint)
                        .font(.footnote)
                        .foregroundStyle(.textSecondary)
                    address
                    nameField
                        .textFieldStyle(.roundedBorder)
                    Button(action: use) {
                        Text(DropPinText.useThisSpot)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.accentProminent)
                    .controlSize(.large)
                    .disabled(model?.pin == nil)
                }
                .padding()
            }
            .navigationTitle(RecordingPageCopy.location)
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(FindRecordingsSheet.back, systemImage: "chevron.backward", action: onBack)
                        .labelStyle(.titleAndIcon)
                }
            }
        }
    #endif
}
