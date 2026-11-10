import SwiftUI

extension EnvironmentValues {
    /// Set by an iPhone or iPad grouped form: the button sits in a row, so its label stays and the
    /// spinner and check sit at the trailing edge instead of replacing it.
    @Entry package var asyncButtonIsRow = false
}

/// A button for an action that takes time. Past `Motion.workingDelay` a spinner replaces the
/// label, and on success a check shows for `Motion.doneHold`. A failure goes to `onFailure`,
/// for the caller to show beside the control; a caller that shows it elsewhere leaves it out.
/// Every failure shakes the button, including a `FailureShownElsewhere`, as the web button does,
/// and Reduce Motion leaves it still. The environment's button style draws it.
package struct AsyncButton<Label: View>: View {
    private let role: ButtonRole?
    private let closesOnSuccess: Bool
    private let action: () async throws -> Void
    private let onFailure: (any Error) -> Void
    private let label: Label

    package init(
        role: ButtonRole? = nil,
        closesOnSuccess: Bool = false,
        action: @escaping () async throws -> Void,
        onFailure: @escaping (any Error) -> Void = { _ in },
        @ViewBuilder label: () -> Label
    ) {
        self.role = role
        self.closesOnSuccess = closesOnSuccess
        self.action = action
        self.onFailure = onFailure
        self.label = label()
    }

    /// Made on the first press, so a parent that rebuilds this button makes no runner.
    @State private var runner: WorkRunner?

    package var body: some View {
        let phase = runner?.phase ?? .idle
        Button(role: role, action: run) {
            WorkingLabel(phase: phase) { label }
        }
        .workState(runner)
        .onDisappear { runner?.cancel() }
    }

    private func run() {
        let runner = runner ?? WorkRunner()
        self.runner = runner
        Task {
            do {
                try await runner.run(closesOnSuccess: closesOnSuccess, action)
            } catch {
                onFailure(error)
            }
        }
    }
}

/// Thrown by an `AsyncButton` action whose failure the screen already shows, such as in a
/// section's footer, so the button returns to rest with no check.
package struct FailureShownElsewhere: Error {
    package init() {}
}

extension WorkPhase {
    /// What VoiceOver reads for a button in this phase. A button applies it in every phase, so it
    /// keeps its identity, and `onDisappear` never fires from a phase change; an empty value is
    /// announced as no value.
    package var accessibilityValue: Text {
        switch self {
        case .working: Text("Working")
        case .done: Text("Done")
        case .idle, .pending: Text(verbatim: "")
        }
    }
}

extension View {
    /// What every button showing a `WorkingLabel` carries: the phase for VoiceOver, and a shake
    /// on each failed run, so a button with its own runner cannot leave either out.
    package func workState(_ runner: WorkRunner?) -> some View {
        accessibilityValue((runner?.phase ?? .idle).accessibilityValue)
            .failureShake(runner?.failureCount ?? 0)
    }
}

/// A button's label through the phases of its work: a spinner while working and a check once
/// done, over the hidden label so the button keeps its width, or at the trailing edge in a
/// grouped form's row. `AsyncButton` draws its label with it, and a button whose work runs
/// elsewhere, such as a write after a question, passes its own `WorkRunner`'s phase.
package struct WorkingLabel<Label: View>: View {
    private let phase: WorkPhase
    private let label: Label

    @Environment(\.asyncButtonIsRow) private var isRow

    package init(phase: WorkPhase, @ViewBuilder label: () -> Label) {
        self.phase = phase
        self.label = label()
    }

    package var body: some View {
        #if os(macOS)
            content
                .macAnimation(MacMotion.state, value: phase)
        #else
            content
                .phoneAnimation(Motion.state, value: phase)
        #endif
    }

    private var showsIndicator: Bool { phase == .working || phase == .done }

    @ViewBuilder private var content: some View {
        if isRow {
            HStack {
                label
                Spacer(minLength: 0)
                indicator
            }
        } else {
            label
                .opacity(showsIndicator ? 0 : 1)
                .overlay { indicator }
        }
    }

    @ViewBuilder private var indicator: some View {
        switch phase {
        case .working:
            #if os(macOS)
                // The regular spinner is taller than a Mac button's label.
                ProgressView().controlSize(.small)
            #else
                ProgressView()
            #endif
        case .done:
            DoneCheck()
        case .idle, .pending:
            EmptyView()
        }
    }
}

extension AsyncButton where Label == SwiftUI.Label<Text, Image> {
    package init(
        _ title: LocalizedStringKey,
        systemImage: String,
        role: ButtonRole? = nil,
        closesOnSuccess: Bool = false,
        action: @escaping () async throws -> Void,
        onFailure: @escaping (any Error) -> Void
    ) {
        self.init(role: role, closesOnSuccess: closesOnSuccess, action: action, onFailure: onFailure) {
            Label(title, systemImage: systemImage)
        }
    }
}

extension AsyncButton where Label == Text {
    package init(
        _ title: LocalizedStringKey,
        role: ButtonRole? = nil,
        closesOnSuccess: Bool = false,
        action: @escaping () async throws -> Void,
        onFailure: @escaping (any Error) -> Void
    ) {
        self.init(role: role, closesOnSuccess: closesOnSuccess, action: action, onFailure: onFailure) {
            Text(title)
        }
    }
}

/// A checkmark that draws itself on when it appears.
private struct DoneCheck: View {
    @State private var drawn = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Image(systemName: "checkmark")
            .symbolEffect(.drawOn, isActive: !drawn && !reduceMotion)
            .onAppear { drawn = true }
    }
}

#Preview("Async buttons") {
    HStack {
        AsyncButton("Sync now", action: { try await Task.sleep(for: .seconds(2)) }) { _ in }
            .buttonStyle(.tinted)
        AsyncButton("Save", action: { try await Task.sleep(for: .milliseconds(150)) }) { _ in }
            .buttonStyle(.filled)
    }
    .padding()
}
