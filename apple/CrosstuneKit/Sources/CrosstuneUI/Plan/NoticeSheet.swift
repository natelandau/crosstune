import CrosstuneStore
import SwiftUI

/// A one-time plan notice: what the trial means for recordings, and the way to the Plan group.
struct NoticeSheet: View {
    let notice: PlanNotice
    let endsAt: Date?
    let holdsRecordings: Bool
    let onOK: @MainActor () -> Void
    let onSeePlan: @MainActor () -> Void

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
                    Button(PlanText.seePlan, action: onSeePlan)
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
    let onSeePlan: @MainActor () -> Void

    /// One showing of the notice, for `sheet(item:)`.
    private struct Showing: Identifiable {
        let notice: PlanNotice
        var id: PlanNotice { notice }
    }

    func body(content: Content) -> some View {
        content
            .sheet(item: shown) { showing in
                NoticeSheet(
                    notice: showing.notice, endsAt: model?.trialEndsAt,
                    holdsRecordings: model?.holdsRecordings ?? false,
                    onOK: { model?.dismiss() },
                    onSeePlan: {
                        model?.dismiss()
                        onSeePlan()
                    })
            }
    }

    private var shown: Binding<Showing?> {
        Binding {
            model?.showing.map(Showing.init)
        } set: {
            if $0 == nil { model?.dismiss() }
        }
    }
}
