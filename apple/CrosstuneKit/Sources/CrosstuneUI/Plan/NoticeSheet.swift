import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI

/// A one-time plan notice: what the trial means for recordings, and the way to the Plan group,
/// or to Subscribe where the store can sell.
struct NoticeSheet: View {
    let notice: PlanNotice
    let endsAt: Date?
    let holdsRecordings: Bool
    let onOK: @MainActor () -> Void
    let onSeePlan: @MainActor () -> Void
    /// Stands in for See your plan when set.
    var onSubscribe: (@MainActor () -> Void)?

    /// Where Subscribe on `notice` opens the Premium sheet from, nil when the notice keeps See
    /// your plan: the first recording always does, and the trial notices do unless the build
    /// sells and the plan can subscribe.
    nonisolated static func subscribeEntry(_ notice: PlanNotice, plan: Plan, sells: Bool) -> PremiumEntry? {
        guard sells, plan.canSubscribe else { return nil }
        switch notice {
        case .firstRecording: return nil
        case .trialReminder: return .trialReminder
        case .trialEnded: return .trialEnded
        }
    }

    nonisolated static func title(_ notice: PlanNotice, endsAt: Date?) -> String {
        switch notice {
        case .firstRecording: NoticeText.firstRecordingTitle
        case .trialReminder: NoticeText.trialReminderTitle(endsAt: endsAt.map { PlanText.day($0) } ?? "")
        case .trialEnded: NoticeText.trialEndedTitle
        }
    }

    /// The body, one string per paragraph. The reminder adds what happens to recordings only
    /// when the account holds some.
    nonisolated static func paragraphs(_ notice: PlanNotice, endsAt: Date?, holdsRecordings: Bool) -> [String] {
        switch notice {
        case .firstRecording:
            endsAt.map { [NoticeText.firstRecordingBody(endsAt: PlanText.day($0))] } ?? []
        case .trialReminder:
            holdsRecordings
                ? [NoticeText.trialReminderBody, NoticeText.trialReminderRecordings] : [NoticeText.trialReminderBody]
        case .trialEnded:
            [NoticeText.trialEndedBody]
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(Self.title(notice, endsAt: endsAt))
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(Self.paragraphs(notice, endsAt: endsAt, holdsRecordings: holdsRecordings), id: \.self) {
                    Text($0)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    if let onSubscribe {
                        Button(PlanText.subscribe, action: onSubscribe)
                    } else {
                        Button(PlanText.seePlan, action: onSeePlan)
                    }
                    Spacer()
                    Button(NoticeText.ok, action: onOK)
                        .buttonStyle(.slateProminent)
                        .keyboardShortcut(.defaultAction)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .background {
            // Escape counts as OK, while Return stays on the visible OK.
            Button(NoticeText.ok, action: onOK)
                .keyboardShortcut(.cancelAction)
                .hidden()
                .accessibilityHidden(true)
        }
        .macSheetFrame(.form(minHeight: 220))
        .presentationDetents([.medium, .large])
        .shellSheet()
    }
}

/// Presents the plan notice the model shows. Swiping it away or pressing Escape counts as OK.
struct NoticeSheets: ViewModifier {
    let model: NoticeModel?
    let plan: Plan
    /// Whether the build offers purchases.
    let sells: Bool
    let onSeePlan: @MainActor () -> Void
    /// Opens the Premium sheet for the plan, from the notice's entry.
    let onSubscribe: @MainActor (PremiumEntry) -> Void

    /// Subscribe's entry, held until the notice's sheet has gone, since a sheet asked for while
    /// another is leaving does not show. It covers the shell meanwhile, so the next notice waits.
    @State private var subscribing: PremiumEntry?

    /// One showing of the notice, for `sheet(item:)`.
    private struct Showing: Identifiable {
        let notice: PlanNotice
        var id: PlanNotice { notice }
    }

    func body(content: Content) -> some View {
        content
            .coversShell(subscribing != nil)
            .sheet(item: shown, onDismiss: openSubscribe) { showing in
                NoticeSheet(
                    notice: showing.notice, endsAt: model?.trialEndsAt,
                    holdsRecordings: model?.holdsRecordings ?? false,
                    onOK: { model?.dismiss() },
                    onSeePlan: {
                        model?.dismiss()
                        onSeePlan()
                    },
                    onSubscribe: subscribe(showing.notice))
            }
    }

    /// Subscribe for `notice`, nil when it keeps See your plan.
    private func subscribe(_ notice: PlanNotice) -> (@MainActor () -> Void)? {
        guard let entry = NoticeSheet.subscribeEntry(notice, plan: plan, sells: sells) else { return nil }
        return {
            subscribing = entry
            model?.dismiss()
        }
    }

    private func openSubscribe() {
        guard let entry = subscribing else { return }
        // The Premium sheet's request holds the menus before this cover lets go. The record slot
        // returns until that sheet appears and claims it.
        onSubscribe(entry)
        subscribing = nil
    }

    private var shown: Binding<Showing?> {
        Binding {
            model?.showing.map(Showing.init)
        } set: {
            if $0 == nil { model?.dismiss() }
        }
    }
}
