import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// The recording screen's keys while it holds the keyboard and no field does: Space plays and
/// pauses; the arrows move the playhead a second (five with Shift), unless a focused handle
/// takes them; `[` and `]` set the selected loop's edges at the playhead; N adds a loop; Delete
/// removes the selected loop and Return names it; Escape closes a name field, then deselects,
/// then closes the screen. Every key but Escape is off while a name field is being typed in,
/// and a focused slider or button keeps these keys too. While the screen cannot be used yet,
/// only Escape works.
struct PracticeKeys: ViewModifier {
    let model: PracticeModel
    let isBlocked: Bool
    /// Delete removed the selected loop.
    let onDeleted: () -> Void
    let onClose: () -> Void

    private var isReady: Bool { !isBlocked && model.isLoaded && !TextEntry.isActive }

    func body(content: Content) -> some View {
        content
            .onKeyPress(.space, phases: .down) { _ in
                guard isReady else { return .ignored }
                model.togglePlay()
                return .handled
            }
            .onKeyPress(characters: CharacterSet(charactersIn: "nN[]"), phases: .down) { press in
                guard isReady, press.modifiers.isDisjoint(with: .otherCommand) else { return .ignored }
                switch press.characters {
                case "[": model.setEdge(.start)
                case "]": model.setEdge(.end)
                default: model.newLoop()
                }
                return .handled
            }
            .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in
                guard isReady, press.modifiers.isDisjoint(with: .otherCommand) else { return .ignored }
                let step = press.modifiers.contains(.shift) ? PracticeModel.arrowLargeStepMs : PracticeModel.arrowStepMs
                model.seek(byMs: press.key == .leftArrow ? -step : step)
                return .handled
            }
            .onKeyPress(keys: [.delete, .deleteForward], phases: .down) { press in
                guard isReady, press.modifiers.isDisjoint(with: .otherCommand) else { return .ignored }
                guard model.deleteSelected() else { return .ignored }
                onDeleted()
                return .handled
            }
            .onKeyPress(.return, phases: .down) { _ in
                guard !isBlocked, !TextEntry.isActive else { return .ignored }
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
