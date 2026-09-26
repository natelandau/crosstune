import CrosstuneVocabulary
import SwiftUI

/// Status as a rail of capsules, each with its own dot, wherever status is set or filtered.
///
/// Setting a tune's status is a required field: pressing the chosen capsule leaves it chosen.
/// Filtering is optional and leads with All: pressing the chosen status clears the filter.
public struct StatusRail: View {
    nonisolated public static let label = "Status"
    nonisolated public static let all = "All"

    private enum Mode {
        case required(Binding<String>)
        case filter(Binding<String?>)
    }

    private let mode: Mode
    private let inset: CGFloat
    /// Counts presses that change the choice, so the haptic answers the musician's own press and
    /// never a value that arrives from elsewhere, such as a sync.
    @State private var changes = 0

    /// Sets a tune's status, which always holds a value.
    public init(status: Binding<String>, inset: CGFloat = 0) {
        mode = .required(status)
        self.inset = inset
    }

    /// Narrows by status; nil is All. `inset` is the space before the first capsule and after
    /// the last, which a scrolling rail runs under to the edge.
    public init(filter: Binding<String?>, inset: CGFloat = 0) {
        mode = .filter(filter)
        self.inset = inset
    }

    /// The status a press leaves chosen, nil for All. A required rail never clears; an optional
    /// one clears when its chosen status is pressed again.
    nonisolated public static func pressing(_ pressed: String?, current: String?, required: Bool) -> String? {
        guard !required else { return pressed ?? current }
        return pressed == current ? nil : pressed
    }

    /// The capsule shown as chosen. A stored status this build cannot read shows as want to
    /// learn; a filter on one matches no capsule and reads as All.
    nonisolated public static func chosen(_ value: String?, required: Bool) -> String? {
        if required { return StatusStyle.normalized(value ?? "") }
        return value.flatMap { Vocabulary.statusLabels[$0] == nil ? nil : $0 }
    }

    private var isRequired: Bool {
        if case .required = mode { return true }
        return false
    }

    private var current: String? {
        switch mode {
        case .required(let binding): Self.chosen(binding.wrappedValue, required: true)
        case .filter(let binding): Self.chosen(binding.wrappedValue, required: false)
        }
    }

    private func press(_ status: String?) {
        let next = Self.pressing(status, current: current, required: isRequired)
        if next != current { changes += 1 }
        switch mode {
        case .required(let binding): if let next { binding.wrappedValue = next }
        case .filter(let binding): binding.wrappedValue = next
        }
    }

    public var body: some View {
        Rail(chosen: current ?? Self.all, inset: inset) {
            capsules
        }
        .sensoryFeedback(.selection, trigger: changes)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Self.label)
    }

    @ViewBuilder private var capsules: some View {
        if !isRequired {
            ChoiceCapsule(chosen: current == nil) {
                press(nil)
            } label: {
                Text(Self.all)
            }
            .id(Self.all)
        }
        ForEach(Vocabulary.statuses, id: \.self) { status in
            let isChosen = current == status
            ChoiceCapsule(chosen: isChosen) {
                press(status)
            } label: {
                StatusDot(status, onFill: isChosen)
            }
            .id(status)
        }
    }
}

#Preview("Status rails") {
    @Previewable @State var status = "learning"
    @Previewable @State var filter: String? = nil
    VStack(alignment: .leading, spacing: 16) {
        StatusRail(status: $status)
        StatusRail(filter: $filter)
    }
    .padding()
}
