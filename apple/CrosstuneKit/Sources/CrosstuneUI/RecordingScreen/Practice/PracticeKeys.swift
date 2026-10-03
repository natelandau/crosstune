import CrosstuneStore
import SwiftUI

/// The recording screen's keys while it holds the keyboard and no field does: Space plays and
/// pauses; the arrows move the playhead a second (five with Shift), or nudge a focused handle;
/// `[` and `]` set the selected loop's edges at the playhead; N adds a loop; Delete removes the
/// selected loop and Return names it; Escape closes a name field, then deselects, then closes
/// the screen. A focused text field, slider, or button keeps these keys, so they are heard only
/// when nothing inside wants them. While the screen cannot be used yet, only Escape works.
struct PracticeKeys: ViewModifier {
    let model: PracticeModel
    var focus: FocusState<PracticeFocus?>.Binding
    let isBlocked: Bool
    /// Delete removed the selected loop.
    let onDeleted: () -> Void
    let onClose: () -> Void

    /// Modifiers that make a key some other command, which these keys leave alone.
    private static let commandModifiers: EventModifiers = [.command, .control, .option]

    private var isReady: Bool { !isBlocked && model.isLoaded }

    func body(content: Content) -> some View {
        content
            .onKeyPress(.space, phases: .down) { _ in
                guard isReady else { return .ignored }
                model.player.audio.toggle()
                return .handled
            }
            .onKeyPress(characters: CharacterSet(charactersIn: "nN[]"), phases: .down) { press in
                guard isReady, press.modifiers.isDisjoint(with: Self.commandModifiers) else { return .ignored }
                switch press.characters {
                case "[": model.setEdge(.start)
                case "]": model.setEdge(.end)
                default: model.newLoop()
                }
                return .handled
            }
            // Held arrows repeat, sweeping the handle, as a slider does; letting go writes it once.
            .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow], phases: .all) { press in
                guard !isBlocked, press.modifiers.isDisjoint(with: Self.commandModifiers) else { return .ignored }
                let back = press.key == .leftArrow || press.key == .downArrow
                let large = press.modifiers.contains(.shift)
                if case .handle(let edge) = focus.wrappedValue {
                    if press.phase == .up {
                        model.commitNudge()
                    } else {
                        let step = large ? PracticeModel.largeNudgeMs : PracticeModel.nudgeMs
                        model.nudge(edge, by: back ? -step : step)
                    }
                    return .handled
                }
                guard press.phase != .up, press.key == .leftArrow || press.key == .rightArrow, isReady else {
                    return .ignored
                }
                let step = large ? PracticeModel.arrowLargeStepMs : PracticeModel.arrowStepMs
                model.seek(byMs: back ? -step : step)
                return .handled
            }
            .onKeyPress(keys: [.delete, .deleteForward], phases: .down) { press in
                guard isReady, press.modifiers.isDisjoint(with: Self.commandModifiers) else { return .ignored }
                guard model.deleteSelected() else { return .ignored }
                onDeleted()
                return .handled
            }
            .onKeyPress(.return, phases: .down) { _ in
                guard !isBlocked else { return .ignored }
                return model.renameSelected() ? .handled : .ignored
            }
            .onKeyPress(.escape, phases: .down) { _ in
                model.escape(orClose: onClose)
                return .handled
            }
            #if os(macOS)
                // Escape can reach the window as its cancel command rather than as a key press.
                .onExitCommand { model.escape(orClose: onClose) }
            #endif
    }
}
