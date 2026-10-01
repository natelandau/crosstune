import CrosstuneAudio
import CrosstuneStore
import SwiftUI

/// What holds the keyboard in Practice: the screen itself, or one of the selected loop's handles.
enum PracticeFocus: Hashable {
    case screen
    case handle(LoopModel.Edge)
}

/// Where the musician learns a recording: the loops on a zoomable waveform, A B and Repeat, speed
/// and pitch, and the loop list. A phone stacks it all; a landscape phone keeps the stack with a
/// shorter waveform; iPad and Mac put the steppers and the list in a column of their own.
struct PracticeScreen: View {
    let model: PracticeModel
    /// The recording's name, under the screen's title.
    let title: String
    /// The peaks for the recording's trim range.
    let peaks: ShownPeaks?
    /// Returns to the recording screen.
    let onDone: () -> Void

    @Environment(\.spacing) private var spacing
    @Environment(\.undoManager) private var undoManager
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @FocusState private var focus: PracticeFocus?

    private var player: PlayerModel { model.player }

    var body: some View {
        @Bindable var model = model
        content
            .navigationTitle(PracticeText.practice)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 0) {
                            Text(PracticeText.practice).font(.headline)
                            Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            #else
                .navigationSubtitle(title)
            #endif
            .focusable()
            .focusEffectDisabled()
            .focused($focus, equals: .screen)
            .defaultFocus($focus, .screen)
            .modifier(PracticeKeys(model: model, focus: $focus, onDone: onDone))
            .onChange(of: focus) { _, _ in model.commitNudge() }
            .onChange(of: player.audio.elapsed, initial: true) { _, elapsed in model.observe(elapsed: elapsed) }
            .onChange(of: model.lengthMs) { _, _ in model.ensureZoom() }
            .task(id: model.autoPan != 0) {
                while model.autoPan != 0, !Task.isCancelled {
                    model.autoPanStep()
                    try? await Task.sleep(for: .milliseconds(16))
                }
            }
            .onAppear { model.undoManager = undoManager }
            .onChange(of: undoManager) { _, manager in model.undoManager = manager }
            .onDisappear { model.leave() }
            #if os(iOS)
                .sensoryFeedback(.impact(weight: .light), trigger: model.snaps)
            #endif
            .undoBanner($model.undoBanner)
    }

    @ViewBuilder private var content: some View {
        if horizontalSizeClass == .regular && verticalSizeClass == .regular {
            HStack(alignment: .top, spacing: spacing.sectionGap) {
                ScrollView {
                    VStack(spacing: spacing.sectionGap) {
                        failure
                        lanes
                        transport
                    }
                    .padding(16)
                }
                .frame(maxWidth: .infinity)
                List {
                    steppersRow
                    LoopList(model: model)
                    Text(PracticeText.shortcutHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                }
                .listStyle(.plain)
                .frame(maxWidth: .infinity)
            }
        } else {
            List {
                Group {
                    failure
                    lanes
                    transport
                    steppersRow
                }
                .listRowSeparator(.hidden)
                LoopList(model: model)
            }
            .listStyle(.plain)
        }
    }

    @ViewBuilder private var failure: some View {
        if let message = player.failure ?? model.failure {
            PlayerFailureText(message)
                .frame(maxWidth: .infinity)
        }
    }

    private var lanes: some View {
        PracticeLanes(
            model: model, peaks: peaks, detailHeight: verticalSizeClass == .compact ? 80 : 120, focus: $focus)
    }

    private var transport: some View {
        PracticeTransport(model: model)
    }

    private var steppersRow: some View {
        PracticeSteppers(player: player)
            .listRowSeparator(.hidden)
    }
}

/// Space plays and pauses, R toggles Repeat, `[` and `]` mark a loop's edges at the playhead,
/// the arrows nudge a focused handle (or skip), Delete removes the selected loop, Return names
/// it, and Escape drops a pending mark or a name field before it leaves Practice. A focused
/// text field keeps these keys, so they are heard only when nothing inside wants them.
private struct PracticeKeys: ViewModifier {
    let model: PracticeModel
    var focus: FocusState<PracticeFocus?>.Binding
    let onDone: () -> Void

    /// Modifiers that make a key some other command, which these keys leave alone.
    private static let commandModifiers: EventModifiers = [.command, .control, .option]

    func body(content: Content) -> some View {
        content
            .onKeyPress(.space, phases: .down) { _ in
                guard model.isLoaded else { return .ignored }
                model.player.audio.toggle()
                return .handled
            }
            .onKeyPress(characters: CharacterSet(charactersIn: "rR[]"), phases: .down) { press in
                guard press.modifiers.isDisjoint(with: Self.commandModifiers) else { return .ignored }
                switch press.characters {
                case "[": model.markStart()
                case "]": model.markEnd()
                default: model.toggleRepeat()
                }
                return .handled
            }
            // Held arrows repeat, sweeping the handle, as a slider does; letting go writes it once.
            .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow], phases: .all) { press in
                guard press.modifiers.isDisjoint(with: Self.commandModifiers) else { return .ignored }
                let back = press.key == .leftArrow || press.key == .downArrow
                if case .handle(let edge) = focus.wrappedValue {
                    if press.phase == .up {
                        model.commitNudge()
                    } else {
                        let step = press.modifiers.contains(.shift) ? PracticeModel.largeNudgeMs : PracticeModel.nudgeMs
                        model.nudge(edge, by: back ? -step : step)
                    }
                    return .handled
                }
                guard press.phase == .down, press.key == .leftArrow || press.key == .rightArrow, model.isLoaded
                else { return .ignored }
                model.player.audio.skip(by: back ? -AudioPlayer.skipInterval : AudioPlayer.skipInterval)
                return .handled
            }
            .onKeyPress(keys: [.delete, .deleteForward], phases: .down) { press in
                guard press.modifiers.isDisjoint(with: Self.commandModifiers) else { return .ignored }
                return model.deleteSelected() ? .handled : .ignored
            }
            .onKeyPress(.return, phases: .down) { _ in
                model.renameSelected() ? .handled : .ignored
            }
            .onKeyPress(.escape, phases: .down) { _ in
                if !model.escape() { onDone() }
                return .handled
            }
    }
}
