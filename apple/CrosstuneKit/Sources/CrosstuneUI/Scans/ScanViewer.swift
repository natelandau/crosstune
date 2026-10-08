import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import ImageIO
import Observation
import SwiftUI
import os

/// Which scan the pager shows and what its indicator says.
enum ScanPager {
    /// The scan the viewer opens on: the one asked for, or the last when scans have gone since.
    static func initialScan(ids: [String], startIndex: Int) -> String? {
        guard !ids.isEmpty else { return nil }
        return ids[min(max(0, startIndex), ids.count - 1)]
    }

    /// "2 of 3" for the scan on show, counting a scan that has left the tune as the first.
    static func indicator(shown: String?, ids: [String]) -> String {
        guard !ids.isEmpty else { return "" }
        let index = shown.flatMap { ids.firstIndex(of: $0) } ?? 0
        return ScanCopy.scanCount(index: index, total: ids.count)
    }
}

/// How far a scan zooms: fitted to the screen, twice that on a double tap, and up to the
/// maximum with a pinch.
enum ScanZoom {
    static let fit: CGFloat = 1
    static let double: CGFloat = 2
    static let maximum: CGFloat = 5

    static func toggled(_ scale: CGFloat) -> CGFloat {
        scale > fit ? fit : double
    }

    static func clamped(_ scale: CGFloat) -> CGFloat {
        min(max(scale, fit), maximum)
    }

    /// A pan held to how far the zoomed scan overflows its container, so an edge of the scan
    /// never pulls in past the container's edge. A scan fitted inside `container` keeps its
    /// aspect ratio, so it may overflow on one axis only.
    static func clampedOffset(
        _ offset: CGSize, container: CGSize, aspectRatio: CGFloat, scale: CGFloat
    ) -> CGSize {
        guard container.width > 0, container.height > 0, aspectRatio > 0 else { return .zero }
        let fitted =
            container.width / container.height > aspectRatio
            ? CGSize(width: container.height * aspectRatio, height: container.height)
            : CGSize(width: container.width, height: container.width / aspectRatio)
        let reach = CGSize(
            width: max(0, (fitted.width * scale - container.width) / 2),
            height: max(0, (fitted.height * scale - container.height) / 2))
        return CGSize(
            width: min(max(offset.width, -reach.width), reach.width),
            height: min(max(offset.height, -reach.height), reach.height))
    }
}

/// The viewer's live read of a tune: its title and scans, or gone.
@MainActor
@Observable
final class ScanViewerModel {
    enum Phase: Equatable {
        case loading
        case shown(title: String, scans: [Scan])
        /// The tune is gone, or has no scan left to show.
        case gone
    }

    private(set) var failure: String?

    private let store: CrosstuneStore
    private let tuneID: String
    private let analytics: AnalyticsClient
    private let query: LiveQuery<Phase>
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "scan-viewer")

    init(store: CrosstuneStore, tuneID: String, analytics: AnalyticsClient = .noop) {
        self.store = store
        self.tuneID = tuneID
        self.analytics = analytics
        query = LiveQuery(store, initial: .loading) { db in
            guard let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil else { return .gone }
            let scans = try Scan.fetch(db, tuneID: tuneID)
            return scans.isEmpty ? .gone : .shown(title: tune.title, scans: scans)
        }
    }

    var phase: Phase { query.value }
    var folder: URL { store.scansFolder }

    func delete(_ scanID: String) async {
        failure = nil
        do {
            try await Commands(store: store).deleteScan(scanID)
            analytics.send(.scanDeleted(scanID: scanID, tuneID: tuneID))
        } catch {
            Self.logger.warning("Deleting a scan from the viewer failed: \(error)")
            failure = failureMessage(error)
        }
    }

    /// Notes a scan whose file will not decode, once per scan while the viewer is open.
    @ObservationIgnored private var reported: Set<String> = []

    func reportBroken(_ scanID: String) {
        guard reported.insert(scanID).inserted else { return }
        Self.logger.error("A scan image could not be decoded: \(scanID, privacy: .public)")
    }
}

/// A tune's scans over the whole shell, one at a time, for reading at a jam: swipe between them,
/// pinch or double-tap to zoom, Invert for light ink on dark paper. The screen stays awake while
/// it is up. Full screen on iPhone and iPad; a window-filling sheet on Mac, closed by Escape.
public struct ScanViewer: View {
    public static let invertStorageKey = "crosstune.scanInvert"

    private let tuneID: String
    private let startIndex: Int
    private let onShow: (Int) -> Void

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @State private var model: ScanViewerModel?

    /// `onShow` hears the position of each scan the viewer turns to, the first included.
    public init(tuneID: String, startIndex: Int, onShow: @escaping (Int) -> Void = { _ in }) {
        self.tuneID = tuneID
        self.startIndex = startIndex
        self.onShow = onShow
    }

    public var body: some View {
        Group {
            if let model {
                ScanViewerContent(model: model, startIndex: startIndex, onShow: onShow)
            } else {
                Color.clear
            }
        }
        .task(id: tuneID) {
            guard let store else { return }
            model = ScanViewerModel(store: store, tuneID: tuneID, analytics: analytics)
        }
        .shellSheet()
    }
}

private struct ScanViewerContent: View {
    let model: ScanViewerModel
    let startIndex: Int
    let onShow: (Int) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch model.phase {
        case .loading:
            Color.clear
        case .gone:
            // A tune deleted, or emptied of scans, while open has nothing left to show.
            Color.clear.onAppear { dismiss() }
        case .shown(let title, let scans):
            ScanViewerBody(model: model, title: title, scans: scans, startIndex: startIndex, onShow: onShow)
        }
    }
}

/// The pager and its toolbar, once the tune's scans are in hand.
private struct ScanViewerBody: View {
    let model: ScanViewerModel
    let title: String
    let scans: [Scan]
    let onShow: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @AppStorage(ScanViewer.invertStorageKey) private var invert = false
    @State private var shown: String?
    @State private var scale = ScanZoom.fit
    @State private var deleting: Scan?

    /// A Mac sheet's primary action reads as its confirming button, which these are not.
    private var controlsPlacement: ToolbarItemPlacement {
        #if os(macOS)
            .automatic
        #else
            .primaryAction
        #endif
    }

    private func turn(by step: Int, ids: [String]) {
        let index = (shown.flatMap { ids.firstIndex(of: $0) } ?? 0) + step
        guard ids.indices.contains(index) else { return }
        withAnimation(.snappy) { shown = ids[index] }
    }

    init(model: ScanViewerModel, title: String, scans: [Scan], startIndex: Int, onShow: @escaping (Int) -> Void) {
        self.model = model
        self.title = title
        self.scans = scans
        self.onShow = onShow
        _shown = State(initialValue: ScanPager.initialScan(ids: scans.map(\.id), startIndex: startIndex))
    }

    var body: some View {
        let ids = scans.map(\.id)
        let shownIndex = shown.flatMap { ids.firstIndex(of: $0) } ?? 0
        NavigationStack {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(Array(scans.enumerated()), id: \.element.id) { index, scan in
                        ScanSlide(
                            scan: scan, index: index, folder: model.folder, invert: invert,
                            // Only the scans beside the one shown hold their image, so twenty
                            // full scans never sit decoded in memory at once.
                            isNear: abs(index - shownIndex) <= 1,
                            scale: scan.id == shown ? $scale : .constant(ScanZoom.fit),
                            onBroken: { model.reportBroken(scan.id) },
                            onDelete: { deleting = scan }
                        )
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(scan.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $shown)
            .scrollIndicators(.never)
            // A zoomed scan pans under the finger rather than turning to the next.
            .scrollDisabled(scale > ScanZoom.fit)
            .background(invert ? Color.black : Color.white)
            .safeAreaInset(edge: .top, spacing: 0) {
                if let failure = model.failure {
                    FailureText(failure)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(.bar)
                }
            }
            .onChange(of: shown) { scale = ScanZoom.fit }
            .onChange(of: shownIndex, initial: true) { onShow(shownIndex) }
            .navigationTitle(ScanPager.indicator(shown: shown, ids: ids))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .accessibilityElement(children: .contain)
            .accessibilityLabel("\(title) \(ScanCopy.scans.lowercased())")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(ScanCopy.close) { dismiss() }
                }
                #if os(macOS)
                    // A mouse has no swipe, so the Mac turns scans with buttons and the arrow keys.
                    ToolbarItemGroup(placement: .automatic) {
                        Button(ScanCopy.previousScan, systemImage: "chevron.left") { turn(by: -1, ids: ids) }
                            .disabled(shownIndex == 0)
                            .keyboardShortcut(.leftArrow, modifiers: [])
                        Button(ScanCopy.nextScan, systemImage: "chevron.right") { turn(by: 1, ids: ids) }
                            .disabled(shownIndex >= ids.count - 1)
                            .keyboardShortcut(.rightArrow, modifiers: [])
                    }
                #endif
                ToolbarItemGroup(placement: controlsPlacement) {
                    Toggle(
                        isOn: Binding {
                            scale > ScanZoom.fit
                        } set: { zoomed in
                            withAnimation(.snappy) { scale = zoomed ? ScanZoom.double : ScanZoom.fit }
                        }
                    ) {
                        Label(ScanCopy.zoom, systemImage: "plus.magnifyingglass")
                    }
                    .toggleStyle(.button)
                    Toggle(isOn: $invert) {
                        Label(ScanCopy.invert, systemImage: "circle.lefthalf.filled")
                    }
                    .toggleStyle(.button)
                }
            }
        }
        .modifier(KeepsScreenAwake())
        .coversShell(deleting != nil)
        .confirmationDialog(
            ScanCopy.deleteTitle,
            isPresented: $deleting.isPresent(),
            titleVisibility: .visible, presenting: deleting
        ) { scan in
            Button(ScanCopy.delete, role: .destructive) {
                Task { await model.delete(scan.id) }
            }
        } message: { scan in
            Text(ScanCopy.deleteMessage(scan))
        }
        #if os(macOS)
            .onExitCommand { dismiss() }
        #endif
    }
}

/// One scan at full size: fitted to its container, zoomed by a pinch or a double tap, and panned
/// while zoomed. A scan whose file has not arrived shows its placeholder; one that will not
/// decode says so, and offers Delete where there is `onDelete`.
struct ScanSlide: View {
    let scan: Scan
    let index: Int
    let folder: URL
    let invert: Bool
    let isNear: Bool
    @Binding var scale: CGFloat
    let onBroken: () -> Void
    let onDelete: (() -> Void)?
    /// A single tap, where there is one. It waits out a double tap, which zooms.
    var onTap: (() -> Void)?

    @State private var decoded: (key: String, image: CGImage?)?
    @State private var pinchStart: CGFloat?
    @State private var offset: CGSize = .zero
    @State private var dragStart: CGSize?
    @State private var size: CGSize = .zero

    var body: some View {
        let key = scan.file.map { ScanThumbnail.key(scan: scan.record, file: $0) }
        let image = decoded?.key == key ? decoded?.image : nil
        Group {
            if scan.file == nil {
                placeholder.modifier(SlideTap(onTap: onTap))
            } else if let image, isNear {
                scanImage(image)
            } else if key != nil && decoded?.key == key && image == nil {
                broken.modifier(SlideTap(onTap: onTap))
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The whole slide, so a zoomed or panned scan stays covered.
        .contentMask()
        .task(id: isNear ? key : nil) {
            guard isNear, let key, let file = scan.file, decoded?.key != key else { return }
            let url = folder.appending(path: file.fileName)
            let image = await Task.detached(priority: .userInitiated) { ScanThumbnail.decodeFull(url) }.value
            // A scan that moved out of reach mid-decode keeps neither the pixels nor a report.
            guard !Task.isCancelled else { return }
            if image == nil { onBroken() }
            decoded = (key, image)
        }
        .onChange(of: isNear) { _, near in
            // A scan out of reach lets go of its pixels.
            if !near { decoded = nil }
        }
        .onGeometryChange(for: CGSize.self) {
            $0.size
        } action: {
            size = $0
            // A turn or resize changes how far the zoomed scan overflows, so the pan follows it.
            offset = ScanZoom.clampedOffset(offset, container: $0, aspectRatio: scan.aspectRatio, scale: scale)
        }
        .onChange(of: scale) { _, new in
            offset = ScanZoom.clampedOffset(offset, container: size, aspectRatio: scan.aspectRatio, scale: new)
        }
    }

    private func scanImage(_ image: CGImage) -> some View {
        Image(decorative: image, scale: 1)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .modifier(Inverted(isOn: invert))
            .scaleEffect(scale)
            .offset(offset)
            .accessibilityLabel(ScanCopy.scan(index))
            .accessibilityAddTraits(.isImage)
            .contentShape(.rect)
            .onTapGesture(count: 2) {
                withAnimation(.snappy) { scale = ScanZoom.toggled(scale) }
            }
            // After the double tap, so a single tap waits until it is not the first of two.
            .modifier(SlideTap(onTap: onTap))
            .gesture(
                MagnifyGesture()
                    .onChanged { value in
                        let start = pinchStart ?? scale
                        pinchStart = start
                        scale = ScanZoom.clamped(start * value.magnification)
                    }
                    .onEnded { _ in pinchStart = nil }
            )
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        guard scale > ScanZoom.fit else { return }
                        let start = dragStart ?? offset
                        dragStart = start
                        offset = ScanZoom.clampedOffset(
                            CGSize(
                                width: start.width + value.translation.width,
                                height: start.height + value.translation.height),
                            container: size, aspectRatio: scan.aspectRatio, scale: scale)
                    }
                    .onEnded { _ in dragStart = nil },
                isEnabled: scale > ScanZoom.fit
            )
    }

    private var placeholder: some View {
        Rectangle()
            .fill(.quaternary)
            .aspectRatio(scan.aspectRatio, contentMode: .fit)
            .frame(maxWidth: 640)
            .overlay {
                if scan.record.state == ScanRecord.pendingUpload {
                    Text(ScanCopy.waiting)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding()
                } else {
                    ProgressView()
                        .accessibilityLabel(ScanCopy.downloadingScan(index))
                }
            }
            .padding()
    }

    private var broken: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(ScanCopy.unreadableScan)
                .font(.headline)
                .foregroundStyle(invert ? Color.white : Color.primary)
            if let onDelete {
                Button(ScanCopy.delete, role: .destructive, action: onDelete)
                    .buttonStyle(.bordered)
                    .accessibilityLabel(ScanCopy.deleteScan(index))
            }
        }
        .padding(32)
    }
}

/// A scan slide's single tap, where it has one.
private struct SlideTap: ViewModifier {
    let onTap: (() -> Void)?

    func body(content: Content) -> some View {
        if let onTap {
            content.onTapGesture(perform: onTap)
        } else {
            content
        }
    }
}

/// Light ink on dark paper, when on.
private struct Inverted: ViewModifier {
    let isOn: Bool

    func body(content: Content) -> some View {
        if isOn {
            content.colorInvert()
        } else {
            content
        }
    }
}

/// A tune whose scans to show, as the viewer's presentation identity, and where it was asked for.
struct ScanRequest: Identifiable, Equatable {
    let tuneID: String
    let startIndex: Int
    let origin: ScanViewOrigin

    var id: String { tuneID }
}

/// The scan viewer the tune screen and tune rows ask for, presented over the whole shell, and
/// the read of which tunes have scans that every row's Scans action follows. The iPad's practice
/// cover applies its own, since the shell's cannot present over that cover.
/// Each look at the scans is logged into the shell's store, timed while this window is in the
/// foreground, so each window counts its own viewer.
struct ScanScreens: ViewModifier {
    /// Whether the viewer zooms out of the thumbnail it opened on, where one is marked.
    var zooms = true

    @State private var request: ScanRequest?
    /// The position of the scan the open viewer shows, which its close zooms back into.
    @State private var shownIndex: Int?
    @State private var tunes: ScanTunes?
    /// Made once the store is known, for that store; nil while there is none.
    @State private var log: ScanViewLog?
    @Environment(\.analytics) private var analytics
    @Environment(\.tuneScreenActions) private var tuneScreenActions
    @Environment(\.store) private var store
    @Environment(\.scenePhase) private var scenePhase
    #if os(iOS)
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Namespace private var zoom
    #endif

    /// The zoom source a tune page's thumbnail marks, so the viewer opened on that scan zooms
    /// out of it and back into it.
    static func sourceID(tuneID: String, index: Int) -> String {
        "\(tuneID)#\(index)"
    }

    /// The thumbnail the viewer for `request` zooms out of and back into: the scan showing
    /// now, once the viewer has said, else the one it opened on. Only the tune page marks its
    /// thumbnails; a row's Scans action has none.
    static func zoomSourceID(_ request: ScanRequest, shownIndex: Int?) -> String? {
        guard request.origin == .tune else { return nil }
        return sourceID(tuneID: request.tuneID, index: shownIndex ?? request.startIndex)
    }

    func body(content: Content) -> some View {
        content
            .environment(\.tuneScreenActions, withViewScans)
            #if os(iOS)
                .environment(\.scanZoom, zoomNamespace)
            #endif
            .environment(tunes)
            .task(id: store.map(ObjectIdentifier.init)) {
                tunes = store.map(ScanTunes.init(store:))
                // Another account's store gets a log of its own, dropping the view open in this one.
                log = store.map {
                    ScanViewLog(
                        writer: .store($0), analytics: analytics, isForeground: scenePhase != .background)
                }
            }
            .onChange(of: request) { old, new in
                log?.follow(from: old, to: new)
                shownIndex = nil
            }
            .onChange(of: scenePhase) {
                log?.foreground(scenePhase != .background)
            }
            #if os(macOS)
                .sheet(item: $request) { request in
                    ScanViewer(tuneID: request.tuneID, startIndex: request.startIndex)
                    .macSheetFrame(MacSheetSize(minWidth: 640, idealWidth: 820, minHeight: 640, idealHeight: 900))
                    .onDisappear { log?.viewerDisappeared(tuneID: request.tuneID) }
                }
            #else
                .fullScreenCover(item: $request) { request in
                    ScanViewer(tuneID: request.tuneID, startIndex: request.startIndex) { shownIndex = $0 }
                    .onDisappear { log?.viewerDisappeared(tuneID: request.tuneID) }
                    .zooms(from: Self.zoomSourceID(request, shownIndex: shownIndex), in: zoomNamespace)
                }
            #endif
    }

    #if os(iOS)
        private var zoomNamespace: Namespace.ID? {
            zooms && !reduceMotion ? zoom : nil
        }
    #endif

    /// The tune screen's actions as set further out, with the viewer opening on a scan.
    private var withViewScans: TuneScreenActions {
        var actions = tuneScreenActions
        actions.viewScans = { tuneID, startIndex, origin in
            request = ScanRequest(tuneID: tuneID, startIndex: startIndex, origin: origin)
        }
        return actions
    }
}
