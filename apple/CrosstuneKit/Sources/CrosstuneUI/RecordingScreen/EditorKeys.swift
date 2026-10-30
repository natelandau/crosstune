import SwiftUI

extension EventModifiers {
    /// Modifiers that make a key some other command, which the recording screen's keys leave alone.
    static let otherCommand: EventModifiers = [.command, .control, .option]
}
