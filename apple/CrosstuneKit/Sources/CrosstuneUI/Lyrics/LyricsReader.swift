import CrosstuneStore
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// The words at reading distance, over the whole shell: a size the musician can grow or shrink,
/// kept from device sleep while it is up. Full screen on iPhone and iPad; a window-filling sheet
/// on Mac, closed by Escape or Done.
public struct LyricsReader: View {
    public static let smallerText = "Smaller text"
    public static let largerText = "Larger text"
    public static let close = "Close"
    public static let editLyrics = "Edit lyrics"
    public static let done = "Done"

    private let tuneID: String

    @Environment(\.store) private var store
    @Environment(\.dismiss) private var dismiss
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
            model = LyricsReaderModel(store: store, tuneID: tuneID)
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

    private var verses: [[String]] { LyricLines.lines(lyrics) }
    private var clampedStep: Int { LyricsSize.clamp(step) }
    private var pointSize: CGFloat { LyricsSize.pointSize(for: clampedStep) * dynamicTypeScale }
    private var atSmallest: Bool { clampedStep <= 1 }
    private var atLargest: Bool { clampedStep >= LyricsSize.steps }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: pointSize * 0.9) {
                    ForEach(Array(verses.enumerated()), id: \.offset) { _, verse in
                        // The same gap the paragraph style below puts between a line's own
                        // wrapped rows, so a wrapped continuation and a new lyric line read at
                        // the same distance from the row above them.
                        VStack(alignment: .leading, spacing: pointSize * 0.3) {
                            ForEach(Array(verse.enumerated()), id: \.offset) { _, line in
                                LyricLineText(text: line, pointSize: pointSize, lineSpacing: pointSize * 0.3)
                            }
                        }
                    }
                    // After the words, not in the toolbar: a musician who has read to the end is
                    // already here, and a scroll mid-tune never reaches it.
                    Button(LyricsReader.editLyrics) { editing = true }
                        .buttonStyle(.bordered)
                }
                .frame(maxWidth: 600, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(24)
                // Leaves room for the last verse to sit mid-screen, where a propped phone is
                // read, rather than against the bottom edge.
                .padding(.bottom, 160)
            }
            .navigationTitle(title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button(LyricsReader.smallerText, systemImage: "textformat.size.smaller") {
                        step = LyricsSize.clamp(clampedStep - 1)
                    }
                    .disabled(atSmallest)
                    Button(LyricsReader.largerText, systemImage: "textformat.size.larger") {
                        step = LyricsSize.clamp(clampedStep + 1)
                    }
                    .disabled(atLargest)
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
        #if os(macOS)
            .onExitCommand { dismiss() }
        #endif
    }
}

/// The whole lyrics body, over the reader. No tune form stands behind it, so Done is the write,
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

    var body: some View {
        NavigationStack {
            LyricsEditor(lyrics: $draft)
                .safeAreaInset(edge: .bottom) {
                    if let failure = model.failure {
                        Text(failure)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .padding()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel) { dismiss() }
                            .disabled(model.isSaving)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(LyricsReader.done, action: save)
                            .fontWeight(.semibold)
                            .disabled(model.isSaving)
                    }
                }
        }
        .interactiveDismissDisabled(draft != initial || model.isSaving)
    }

    private func save() {
        Task {
            if await model.save(draft) { dismiss() }
        }
    }
}

/// Disables the device's idle timer while `content` is on screen, restoring it on dismiss and
/// while the app is not active, since a screen backgrounded mid-reading is not being read.
private struct KeepsScreenAwake: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onAppear { setIdleTimerDisabled(scenePhase == .active) }
            .onDisappear { setIdleTimerDisabled(false) }
            .onChange(of: scenePhase) { _, phase in
                setIdleTimerDisabled(phase == .active)
            }
    }

    private func setIdleTimerDisabled(_ disabled: Bool) {
        #if os(iOS)
            UIApplication.shared.isIdleTimerDisabled = disabled
        #endif
    }
}

/// A tune to read the lyrics of, as the reader's presentation identity.
private struct LyricsRequest: Identifiable {
    let tuneID: String

    var id: String { tuneID }
}

/// The lyrics reader the tune screen asks for, presented once, over the whole shell.
struct LyricsScreens: ViewModifier {
    @State private var request: LyricsRequest?
    @Environment(\.tuneScreenActions) private var tuneScreenActions

    func body(content: Content) -> some View {
        content
            .environment(\.tuneScreenActions, withReadLyrics)
            #if os(macOS)
                .sheet(item: $request) { request in
                    LyricsReader(tuneID: request.tuneID)
                    .frame(minWidth: 640, idealWidth: 720, minHeight: 640, idealHeight: 760)
                }
            #else
                .fullScreenCover(item: $request) { request in
                    LyricsReader(tuneID: request.tuneID)
                }
            #endif
    }

    /// The tune screen's actions as set further out, with Open lyrics opening the reader.
    private var withReadLyrics: TuneScreenActions {
        var actions = tuneScreenActions
        actions.readLyrics = { tuneID in request = LyricsRequest(tuneID: tuneID) }
        return actions
    }
}
