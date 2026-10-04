import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import ImageIO
import Observation
import SwiftUI
import os

/// Which page the pager shows and what its indicator says.
enum NotationPager {
    /// The page the viewer opens on: the one asked for, or the last when pages have gone since.
    static func initialPage(ids: [String], startIndex: Int) -> String? {
        guard !ids.isEmpty else { return nil }
        return ids[min(max(0, startIndex), ids.count - 1)]
    }

    /// "2 of 3" for the page on show, counting a page that has left the tune as the first.
    static func indicator(shown: String?, ids: [String]) -> String {
        guard !ids.isEmpty else { return "" }
        let index = shown.flatMap { ids.firstIndex(of: $0) } ?? 0
        return NotationCopy.pageCount(index: index, total: ids.count)
    }
}

/// How far a page zooms: fitted to the screen, twice that on a double tap, and up to the
/// maximum with a pinch.
enum NotationZoom {
    static let fit: CGFloat = 1
    static let double: CGFloat = 2
    static let maximum: CGFloat = 5

    static func toggled(_ scale: CGFloat) -> CGFloat {
        scale > fit ? fit : double
    }

    static func clamped(_ scale: CGFloat) -> CGFloat {
        min(max(scale, fit), maximum)
    }

    /// A pan held to how far the zoomed page overflows its container, so an edge of the page
    /// never pulls in past the container's edge. A page fitted inside `container` keeps its
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

/// The viewer's live read of a tune: its title and pages, or gone.
@MainActor
@Observable
final class NotationViewerModel {
    enum Phase: Equatable {
        case loading
        case shown(title: String, pages: [NotationPage])
        /// The tune is gone, or has no page left to show.
        case gone
    }

    private(set) var failure: String?

    private let store: CrosstuneStore
    private let query: LiveQuery<Phase>
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "notation-viewer")

    init(store: CrosstuneStore, tuneID: String) {
        self.store = store
        query = LiveQuery(store, initial: .loading) { db in
            guard let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil else { return .gone }
            let pages = try NotationPage.fetch(db, tuneID: tuneID)
            return pages.isEmpty ? .gone : .shown(title: tune.title, pages: pages)
        }
    }

    var phase: Phase { query.value }
    var folder: URL { store.notationFolder }

    func delete(_ pageID: String) async {
        failure = nil
        do {
            try await Commands(store: store).deleteNotationPage(pageID)
        } catch {
            Self.logger.warning("Deleting a notation page from the viewer failed: \(error)")
            failure = (error as? LocalizedError)?.errorDescription ?? CatalogModel.actionFailed
        }
    }

    /// Notes a page whose file will not decode, once per page while the viewer is open.
    @ObservationIgnored private var reported: Set<String> = []

    func reportBroken(_ pageID: String) {
        guard reported.insert(pageID).inserted else { return }
        Self.logger.error("A notation page image could not be decoded: \(pageID, privacy: .public)")
    }
}

/// A tune's pages over the whole shell, one at a time, for reading at a jam: swipe between them,
/// pinch or double-tap to zoom, Invert for light ink on dark paper. The screen stays awake while
/// it is up. Full screen on iPhone and iPad; a window-filling sheet on Mac, closed by Escape.
public struct NotationViewer: View {
    public static let invertStorageKey = "crosstune.notationInvert"

    private let tuneID: String
    private let startIndex: Int

    @Environment(\.store) private var store
    @State private var model: NotationViewerModel?

    public init(tuneID: String, startIndex: Int) {
        self.tuneID = tuneID
        self.startIndex = startIndex
    }

    public var body: some View {
        Group {
            if let model {
                NotationViewerContent(model: model, startIndex: startIndex)
            } else {
                Color.clear
            }
        }
        .task(id: tuneID) {
            guard let store else { return }
            model = NotationViewerModel(store: store, tuneID: tuneID)
        }
        .shellSheet()
    }
}

private struct NotationViewerContent: View {
    let model: NotationViewerModel
    let startIndex: Int

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch model.phase {
        case .loading:
            Color.clear
        case .gone:
            // A tune deleted, or emptied of pages, while open has nothing left to show.
            Color.clear.onAppear { dismiss() }
        case .shown(let title, let pages):
            NotationViewerPage(model: model, title: title, pages: pages, startIndex: startIndex)
        }
    }
}

/// The pager and its toolbar, once the tune's pages are in hand.
private struct NotationViewerPage: View {
    let model: NotationViewerModel
    let title: String
    let pages: [NotationPage]

    @Environment(\.dismiss) private var dismiss
    @AppStorage(NotationViewer.invertStorageKey) private var invert = false
    @State private var shown: String?
    @State private var scale = NotationZoom.fit
    @State private var deleting: NotationPage?

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

    init(model: NotationViewerModel, title: String, pages: [NotationPage], startIndex: Int) {
        self.model = model
        self.title = title
        self.pages = pages
        _shown = State(initialValue: NotationPager.initialPage(ids: pages.map(\.id), startIndex: startIndex))
    }

    var body: some View {
        let ids = pages.map(\.id)
        let shownIndex = shown.flatMap { ids.firstIndex(of: $0) } ?? 0
        NavigationStack {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                        NotationSlide(
                            page: page, index: index, folder: model.folder, invert: invert,
                            // Only the pages beside the one shown hold their image, so twenty
                            // full pages never sit decoded in memory at once.
                            isNear: abs(index - shownIndex) <= 1,
                            scale: page.id == shown ? $scale : .constant(NotationZoom.fit),
                            onBroken: { model.reportBroken(page.id) },
                            onDelete: { deleting = page }
                        )
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(page.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $shown)
            .scrollIndicators(.never)
            // A zoomed page pans under the finger rather than turning to the next.
            .scrollDisabled(scale > NotationZoom.fit)
            .background(invert ? Color.black : Color.white)
            .safeAreaInset(edge: .top, spacing: 0) {
                if let failure = model.failure {
                    FailureText(failure)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(.bar)
                }
            }
            .onChange(of: shown) { scale = NotationZoom.fit }
            .navigationTitle(NotationPager.indicator(shown: shown, ids: ids))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .accessibilityElement(children: .contain)
            .accessibilityLabel("\(title) \(NotationCopy.notation.lowercased())")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(NotationCopy.close) { dismiss() }
                }
                #if os(macOS)
                    // A mouse has no swipe, so the Mac pages with buttons and the arrow keys.
                    ToolbarItemGroup(placement: .automatic) {
                        Button(NotationCopy.previousPage, systemImage: "chevron.left") { turn(by: -1, ids: ids) }
                            .disabled(shownIndex == 0)
                            .keyboardShortcut(.leftArrow, modifiers: [])
                        Button(NotationCopy.nextPage, systemImage: "chevron.right") { turn(by: 1, ids: ids) }
                            .disabled(shownIndex >= ids.count - 1)
                            .keyboardShortcut(.rightArrow, modifiers: [])
                    }
                #endif
                ToolbarItemGroup(placement: controlsPlacement) {
                    Toggle(
                        isOn: Binding {
                            scale > NotationZoom.fit
                        } set: { zoomed in
                            withAnimation(.snappy) { scale = zoomed ? NotationZoom.double : NotationZoom.fit }
                        }
                    ) {
                        Label(NotationCopy.zoom, systemImage: "plus.magnifyingglass")
                    }
                    .toggleStyle(.button)
                    Toggle(isOn: $invert) {
                        Label(NotationCopy.invert, systemImage: "circle.lefthalf.filled")
                    }
                    .toggleStyle(.button)
                }
            }
        }
        .modifier(KeepsScreenAwake())
        .coversShell(deleting != nil)
        .confirmationDialog(
            NotationCopy.deleteTitle,
            isPresented: Binding {
                deleting != nil
            } set: {
                if !$0 { deleting = nil }
            },
            titleVisibility: .visible, presenting: deleting
        ) { page in
            Button(NotationCopy.delete, role: .destructive) {
                Task { await model.delete(page.id) }
            }
        } message: { page in
            Text(NotationCopy.deleteMessage(page))
        }
        #if os(macOS)
            .onExitCommand { dismiss() }
        #endif
    }
}

/// One page at full size: fitted to the screen, zoomed by a pinch or a double tap, and panned
/// while zoomed. A page whose file has not arrived shows its placeholder; one that will not
/// decode says so and offers Delete.
private struct NotationSlide: View {
    let page: NotationPage
    let index: Int
    let folder: URL
    let invert: Bool
    let isNear: Bool
    @Binding var scale: CGFloat
    let onBroken: () -> Void
    let onDelete: () -> Void

    @State private var decoded: (key: String, image: CGImage?)?
    @State private var pinchStart: CGFloat?
    @State private var offset: CGSize = .zero
    @State private var dragStart: CGSize?
    @State private var size: CGSize = .zero

    var body: some View {
        let key = page.file.map { NotationThumbnail.key(page: page.record, file: $0) }
        let image = decoded?.key == key ? decoded?.image : nil
        Group {
            if page.file == nil {
                placeholder
            } else if let image, isNear {
                pageImage(image)
            } else if key != nil && decoded?.key == key && image == nil {
                broken
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: isNear ? key : nil) {
            guard isNear, let key, let file = page.file, decoded?.key != key else { return }
            let url = folder.appending(path: file.fileName)
            let image = await Task.detached(priority: .userInitiated) { NotationThumbnail.decodeFull(url) }.value
            // A page that moved out of reach mid-decode keeps neither the pixels nor a report.
            guard !Task.isCancelled else { return }
            if image == nil { onBroken() }
            decoded = (key, image)
        }
        .onChange(of: isNear) { _, near in
            // A page out of reach lets go of its pixels.
            if !near { decoded = nil }
        }
        .onGeometryChange(for: CGSize.self) {
            $0.size
        } action: {
            size = $0
            // A turn or resize changes how far the zoomed page overflows, so the pan follows it.
            offset = NotationZoom.clampedOffset(offset, container: $0, aspectRatio: page.aspectRatio, scale: scale)
        }
        .onChange(of: scale) { _, new in
            offset = NotationZoom.clampedOffset(offset, container: size, aspectRatio: page.aspectRatio, scale: new)
        }
    }

    private func pageImage(_ image: CGImage) -> some View {
        Image(decorative: image, scale: 1)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .modifier(Inverted(isOn: invert))
            .scaleEffect(scale)
            .offset(offset)
            .accessibilityLabel(NotationCopy.page(index))
            .accessibilityAddTraits(.isImage)
            .contentShape(.rect)
            .onTapGesture(count: 2) {
                withAnimation(.snappy) { scale = NotationZoom.toggled(scale) }
            }
            .gesture(
                MagnifyGesture()
                    .onChanged { value in
                        let start = pinchStart ?? scale
                        pinchStart = start
                        scale = NotationZoom.clamped(start * value.magnification)
                    }
                    .onEnded { _ in pinchStart = nil }
            )
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        guard scale > NotationZoom.fit else { return }
                        let start = dragStart ?? offset
                        dragStart = start
                        offset = NotationZoom.clampedOffset(
                            CGSize(
                                width: start.width + value.translation.width,
                                height: start.height + value.translation.height),
                            container: size, aspectRatio: page.aspectRatio, scale: scale)
                    }
                    .onEnded { _ in dragStart = nil },
                isEnabled: scale > NotationZoom.fit
            )
    }

    private var placeholder: some View {
        Rectangle()
            .fill(.quaternary)
            .aspectRatio(page.aspectRatio, contentMode: .fit)
            .frame(maxWidth: 640)
            .overlay {
                if page.record.state == NotationPageRecord.pendingUpload {
                    Text(NotationCopy.waiting)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding()
                } else {
                    ProgressView()
                        .accessibilityLabel(NotationCopy.downloadingPage(index))
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
            Text(NotationCopy.unreadablePage)
                .font(.headline)
                .foregroundStyle(invert ? Color.white : Color.primary)
            Button(NotationCopy.delete, role: .destructive, action: onDelete)
                .buttonStyle(.bordered)
                .accessibilityLabel(NotationCopy.deletePage(index))
        }
        .padding(32)
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

/// A tune whose pages to show, as the viewer's presentation identity.
private struct NotationRequest: Identifiable {
    let tuneID: String
    let startIndex: Int

    var id: String { tuneID }
}

/// The notation viewer the tune screen and tune rows ask for, presented once, over the whole
/// shell, and the one read of which tunes have pages that every row's Notation action follows.
struct NotationScreens: ViewModifier {
    @State private var request: NotationRequest?
    @State private var tunes: NotationTunes?
    @Environment(\.tuneScreenActions) private var tuneScreenActions
    @Environment(\.store) private var store

    func body(content: Content) -> some View {
        content
            .environment(\.tuneScreenActions, withViewNotation)
            .environment(tunes)
            .task(id: store.map(ObjectIdentifier.init)) {
                tunes = store.map(NotationTunes.init(store:))
            }
            #if os(macOS)
                .sheet(item: $request) { request in
                    NotationViewer(tuneID: request.tuneID, startIndex: request.startIndex)
                    .frame(minWidth: 640, idealWidth: 820, minHeight: 640, idealHeight: 900)
                }
            #else
                .fullScreenCover(item: $request) { request in
                    NotationViewer(tuneID: request.tuneID, startIndex: request.startIndex)
                }
            #endif
    }

    /// The tune screen's actions as set further out, with the viewer opening on a page.
    private var withViewNotation: TuneScreenActions {
        var actions = tuneScreenActions
        actions.viewNotation = { tuneID, startIndex in
            request = NotationRequest(tuneID: tuneID, startIndex: startIndex)
        }
        return actions
    }
}
