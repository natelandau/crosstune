import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI

/// The words at reading distance, over the whole shell: a size the musician can grow or shrink,
/// kept from device sleep while it is up. Full screen on iPhone and iPad; a window-filling sheet
/// on Mac, closed by Escape or Done.
public struct LyricsReader: View {
    public static let smallerText = "Smaller text"
    public static let largerText = "Larger text"
    public static let close = "Close"
    public static let editLyrics = "Edit lyrics"
    public static let done = "Done"

    #if os(macOS)
        static let macSize = MacSheetSize(minWidth: 640, idealWidth: 720, minHeight: 640, idealHeight: 760)
    #endif

    private let tuneID: String

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @State private var model: LyricsReaderModel?

    public init(tuneID: String) {
        self.tuneID = tuneID
    }

    public var body: some View {
        Group {
            if let model {
                LyricsReaderContent(model: model)
            } else {
                Color.clear
            }
        }
        .task(id: tuneID) {
            guard let store else { return }
            model = LyricsReaderModel(store: store, tuneID: tuneID, analytics: analytics)
        }
        .shellSheet()
    }
}

private struct LyricsReaderContent: View {
    let model: LyricsReaderModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch model.phase {
        case .loading:
            Color.clear
        case .gone:
            // A tune deleted while its lyrics are open has nothing left to read.
            Color.clear.onAppear { dismiss() }
        case .shown(let title, let lyrics):
            LyricsReaderPage(model: model, title: title, lyrics: lyrics ?? "")
                .onAppear { model.shown() }
        }
    }
}

/// The toolbar, the verses, and the size and idle-timer behavior that only make sense once the
/// tune's words are in hand.
private struct LyricsReaderPage: View {
    let model: LyricsReaderModel
    let title: String
    let lyrics: String

    @Environment(\.dismiss) private var dismiss
    @AppStorage(LyricsSize.storageKey) private var step = LyricsSize.defaultStep
    @State private var editing = false
    // A scale factor, not a point size: multiplying each fixed step by it maps the web's fixed
    // reading sizes onto this device's Dynamic Type setting rather than replacing them with it.
    @ScaledMetric(relativeTo: .body) private var dynamicTypeScale: CGFloat = 1

    private var clampedStep: Int { LyricsSize.clamp(step) }
    private var pointSize: CGFloat { LyricsSize.pointSize(for: clampedStep) * dynamicTypeScale }
    private var atSmallest: Bool { !LyricsSize.canShrink(clampedStep) }
    private var atLargest: Bool { !LyricsSize.canGrow(clampedStep) }

    private var smaller: some View {
        Button(LyricsReader.smallerText, systemImage: "textformat.size.smaller") {
            step = LyricsSize.clamp(clampedStep - 1)
        }
        .disabled(atSmallest)
    }

    private var larger: some View {
        Button(LyricsReader.largerText, systemImage: "textformat.size.larger") {
            step = LyricsSize.clamp(clampedStep + 1)
        }
        .disabled(atLargest)
    }

    #if os(macOS)
        /// The title with the text size pair and Done on its line, as the scans' header reads, so
        /// no toolbar overflow can hide a control. Done is not the default: Return reads nothing.
        var body: some View {
            MacSheet(reading: title, size: LyricsReader.macSize, escape: { dismiss() }) {
                Group {
                    smaller.help(LyricsReader.smallerText)
                    larger.help(LyricsReader.largerText)
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.macIcon)
                Button(LyricsReader.done) { dismiss() }
                    .buttonStyle(.macSecondary)
                    .padding(.leading, 4)
            } content: {
                ScrollView {
                    VStack(alignment: .leading, spacing: pointSize * 0.9) {
                        LyricsBody(lyrics: lyrics)
                            .foregroundStyle(Palette.ink)
                        // After the words: a musician who has read to the end is already here.
                        Button(LyricsReader.editLyrics) { editing = true }
                            .buttonStyle(.macPlain)
                    }
                    .frame(maxWidth: PhoneStyle.lyricsMaxWidth, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, MacStyle.pageMargin)
                    .padding(.top, 8)
                    .padding(.bottom, MacStyle.pageMargin)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .sheet(isPresented: $editing) {
                LyricsEditSheet(model: model, lyrics: lyrics)
            }
            .modifier(KeepsScreenAwake())
        }
    #else
        var body: some View {
            phoneBody
        }
    #endif

    #if os(iOS)
        private var phoneBody: some View {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: pointSize * 0.9) {
                        LyricsBody(lyrics: lyrics)
                        // After the words, not in the toolbar: a musician who has read to the end is
                        // already here, and a scroll mid-tune never reaches it.
                        Button(LyricsReader.editLyrics) { editing = true }
                            .buttonStyle(.bordered)
                    }
                    .frame(maxWidth: PhoneStyle.lyricsMaxWidth, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .padding(24)
                    // Leaves room for the last verse to sit mid-screen, where a propped phone is
                    // read, rather than against the bottom edge.
                    .padding(.bottom, 160)
                }
                .paperGround()
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        smaller
                        larger
                    }
                    ToolbarItem(placement: .cancellationAction) {
                        Button(LyricsReader.close) { dismiss() }
                    }
                }
                .sheet(isPresented: $editing) {
                    LyricsEditSheet(model: model, lyrics: lyrics)
                }
            }
            .modifier(KeepsScreenAwake())
        }
    #endif
}

/// A tune's verses at the reader's stored size, which the musician sets in the reader.
struct LyricsBody: View {
    let lyrics: String

    @AppStorage(LyricsSize.storageKey) private var step = LyricsSize.defaultStep
    // A scale factor, not a point size: multiplying each fixed step by it maps the web's fixed
    // reading sizes onto this device's Dynamic Type setting rather than replacing them with it.
    @ScaledMetric(relativeTo: .body) private var dynamicTypeScale: CGFloat = 1

    private var pointSize: CGFloat { LyricsSize.pointSize(for: LyricsSize.clamp(step)) * dynamicTypeScale }

    var body: some View {
        VStack(alignment: .leading, spacing: pointSize * 0.9) {
            ForEach(LyricLines.lines(lyrics).enumerated(), id: \.offset) { _, verse in
                // The same gap the paragraph style puts between a line's own wrapped rows, so a
                // wrapped continuation and a new lyric line read at the same distance from the
                // row above them.
                VStack(alignment: .leading, spacing: pointSize * 0.3) {
                    ForEach(verse.enumerated(), id: \.offset) { _, line in
                        LyricLineText(text: line, pointSize: pointSize, lineSpacing: pointSize * 0.3)
                    }
                }
            }
        }
        .contentMask()
    }
}

/// The whole lyrics body, over the reader. No tune form is behind it, so Done is the write,
/// the way the web's reading view edits without a form.
private struct LyricsEditSheet: View {
    let model: LyricsReaderModel
    let initial: String

    @Environment(\.dismiss) private var dismiss
    @State private var draft: String

    init(model: LyricsReaderModel, lyrics: String) {
        self.model = model
        initial = lyrics
        _draft = State(initialValue: lyrics)
    }

    #if os(macOS)
        var body: some View {
            MacSheet(
                title: LyricsReader.editLyrics, size: .longForm,
                cancel: .cancel(TuneFormSheet.cancel, isEnabled: !model.isSaving) { dismiss() },
                primary: .init(LyricsReader.done, isEnabled: !model.isSaving, action: save)
            ) {
                VStack(alignment: .leading, spacing: 6) {
                    MacTextArea(
                        TuneFieldLabels.lyrics, text: $draft, placeholder: TuneFieldLabels.lyricsPlaceholder,
                        minLines: 20
                    )
                    .characterLimit(Vocabulary.Limits.Tune.lyrics, text: $draft)
                    .frame(maxHeight: .infinity)
                    if let failure = model.failure { FailureText(failure) }
                }
                .padding(.horizontal, MacStyle.sheetMargin)
                .padding(.top, 4)
                .padding(.bottom, MacStyle.sheetMargin)
            }
            .interactiveDismissDisabled(draft != initial || model.isSaving)
        }
    #else
        var body: some View {
            phoneBody
        }
    #endif

    #if os(iOS)
        private var phoneBody: some View {
            NavigationStack {
                LyricsEditor(lyrics: $draft)
                    .safeAreaInset(edge: .bottom) {
                        if let failure = model.failure {
                            Text(failure)
                                .font(.platform(.footnote))
                                .foregroundStyle(.red)
                                .padding()
                        }
                    }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(TuneFormSheet.cancel) { dismiss() }
                                .disabled(model.isSaving)
                        }
                        ConfirmToolbarItem {
                            Button(LyricsReader.done, action: save)
                                .fontWeight(.semibold)
                                .disabled(model.isSaving)
                        }
                    }
            }
            .interactiveDismissDisabled(draft != initial || model.isSaving)
        }
    #endif

    private func save() {
        Task {
            if await model.save(draft) { dismiss() }
        }
    }
}

/// A tune to read the lyrics of, as the reader's presentation identity.
private struct LyricsRequest: Identifiable {
    let tuneID: String
    let origin: LyricsOrigin

    var id: String { tuneID }
}

/// The lyrics reader the tune screen asks for, presented once, over the whole shell.
struct LyricsScreens: ViewModifier {
    @State private var request: LyricsRequest?
    @State private var source = UUID()
    @Environment(\.tuneScreenActions) private var tuneScreenActions
    #if os(iOS)
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Namespace private var zoom
    #endif

    func body(content: Content) -> some View {
        content
            .environment(\.tuneScreenActions, withReadLyrics)
            #if os(iOS)
                .environment(\.lyricsZoom, reduceMotion ? nil : zoom)
            #endif
            #if os(macOS)
                .sheet(item: $request) { request in
                    LyricsReader(tuneID: request.tuneID)
                    .macSheetFrame(LyricsReader.macSize)
                }
            #else
                .fullScreenCover(item: $request) { request in
                    LyricsReader(tuneID: request.tuneID)
                    .zooms(
                        from: Self.sourceID(tuneID: request.tuneID, origin: request.origin),
                        in: reduceMotion ? nil : zoom)
                }
            #endif
    }

    /// The id the control at `origin` marks itself with for the reader to zoom out of.
    fileprivate static func sourceID(tuneID: String, origin: LyricsOrigin) -> String {
        "\(tuneID)#\(origin)"
    }

    /// The tune screen's actions as set further out, with Open lyrics opening the reader.
    private var withReadLyrics: TuneScreenActions {
        tuneScreenActions.supplied(by: source) { actions in
            actions.readLyrics = { tuneID, origin in request = LyricsRequest(tuneID: tuneID, origin: origin) }
        }
    }
}

/// Marks a lyrics control as where the reader it opens zooms out of and back into.
private struct LyricsZoomSource: ViewModifier {
    let tuneID: String
    let origin: LyricsOrigin
    @Environment(\.lyricsZoom) private var zoom

    func body(content: Content) -> some View {
        content.zoomSource(id: LyricsScreens.sourceID(tuneID: tuneID, origin: origin), in: zoom)
    }
}

extension View {
    /// Marks this control as where the reader for `tuneID`, opened from `origin`, zooms out of.
    func lyricsZoomSource(tuneID: String, origin: LyricsOrigin) -> some View {
        modifier(LyricsZoomSource(tuneID: tuneID, origin: origin))
    }
}
