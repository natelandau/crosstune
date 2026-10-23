import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneStore
import Observation
import SwiftUI

/// A one-time plan notice. The first recording's says what the trial means for recordings and
/// leads to the Plan group. The trial notices say what stops and what stays, and sell Annual in
/// place where the store can, with Compare plans opening the Plan sheet.
struct NoticeSheet: View {
    let notice: PlanNotice
    let endsAt: Date?
    let plan: Plan
    /// Nil in a build that offers no purchase.
    let purchase: PurchaseModel?
    /// The instant the days left count from, nil to follow the clock.
    let now: Date?
    /// Takes the notice down and marks it seen.
    let onClose: @MainActor () -> Void
    let onSeePlan: @MainActor () -> Void
    let onComparePlans: @MainActor () -> Void

    /// Whether Subscribe was tried here, so an outcome left by another sheet never shows.
    @State private var tried = false

    init(
        notice: PlanNotice, endsAt: Date?, plan: Plan, purchase: PurchaseModel?, now: Date? = nil,
        onClose: @escaping @MainActor () -> Void, onSeePlan: @escaping @MainActor () -> Void,
        onComparePlans: @escaping @MainActor () -> Void
    ) {
        self.notice = notice
        self.endsAt = endsAt
        self.plan = plan
        self.purchase = purchase
        self.now = now
        self.onClose = onClose
        self.onSeePlan = onSeePlan
        self.onComparePlans = onComparePlans
    }

    /// Where Compare plans or Subscribe on `notice` reports it came from, nil for the first
    /// recording, which offers neither.
    nonisolated static func entry(_ notice: PlanNotice) -> PremiumEntry? {
        switch notice {
        case .firstRecording: nil
        case .trialReminder: .trialReminder
        case .trialEnded: .trialEnded
        }
    }

    /// Whether `notice` offers Subscribe: only a trial notice, in a build that offers purchases,
    /// to an account that can subscribe.
    static func sells(_ notice: PlanNotice, plan: Plan, purchase: PurchaseModel?) -> Bool {
        entry(notice) != nil && plan.canSubscribe && purchase != nil
    }

    /// The store's Annual offer, once it has answered with one.
    nonisolated static func annualOffer(_ offers: PurchaseModel.Offers) -> PurchaseOffer? {
        guard case .ready(let found) = offers else { return nil }
        return found.first { $0.period == .annual }
    }

    /// One of a trial notice's buttons.
    enum Action: Equatable {
        /// Buys Annual at the store's price.
        case subscribe(String)
        /// Holds Subscribe's place while the store answers, so Compare plans never moves under
        /// a tap.
        case waiting
        case comparePlans
        case close

        /// Whether Return presses it. The notice shows unasked, so Return never starts a purchase.
        var isDefault: Bool {
            switch self {
            case .subscribe, .waiting: false
            case .comparePlans, .close: true
            }
        }
    }

    /// What a trial notice offers.
    struct Offer: Equatable {
        let primary: Action
        let secondary: Action?

        /// Whether the renewal terms show, which they do wherever a price does.
        var discloses: Bool { annualPrice != nil }

        /// The Annual price the Subscribe button buys, which the renewal terms state.
        var annualPrice: String? {
            if case .subscribe(let price) = primary { price } else { nil }
        }

        /// The outcome of a try, shown only by the choice it answers or the settled purchase, so
        /// an earlier failure never sits over Compare plans once the store is gone.
        func outcome(_ line: PurchaseModel.Line?) -> String? {
            switch primary {
            case .subscribe, .close: line.map(PlanText.line)
            case .waiting, .comparePlans: nil
            }
        }
    }

    /// Subscribe for Annual over Compare plans where the notice sells and the store has a price
    /// for Annual, its place held while the store answers, otherwise Compare plans alone. A
    /// completed purchase settles on Close, whether or not the plan has turned Premium yet.
    nonisolated static func offer(sells: Bool, offers: PurchaseModel.Offers?, line: PurchaseModel.Line?) -> Offer {
        if line == .subscribed { return Offer(primary: .close, secondary: nil) }
        if sells, let offers {
            if offers == .loading { return Offer(primary: .waiting, secondary: .comparePlans) }
            if let annual = annualOffer(offers) {
                return Offer(primary: .subscribe(annual.price), secondary: .comparePlans)
            }
        }
        return Offer(primary: .comparePlans, secondary: nil)
    }

    /// Buys Annual, whichever period the Plan sheet last chose.
    static func subscribe(_ purchase: PurchaseModel, from entry: PremiumEntry) async {
        purchase.period = .annual
        await PlanSheet.subscribe(purchase, from: entry)
    }

    nonisolated static func title(_ notice: PlanNotice, endsAt: Date?) -> String {
        switch notice {
        case .firstRecording: NoticeText.firstRecordingTitle
        case .trialReminder: NoticeText.trialReminderTitle(endsAt: endsAt.map { PlanText.day($0) } ?? "")
        case .trialEnded: NoticeText.trialEndedTitle
        }
    }

    /// The reminder's days left, under its title.
    nonisolated static func subtitle(_ notice: PlanNotice, endsAt: Date?, now: Date) -> String? {
        guard notice == .trialReminder, let endsAt else { return nil }
        return NoticeText.daysLeft(PlanText.trialDays(endsAt: endsAt, now: now))
    }

    nonisolated static func firstRecordingBody(endsAt: Date?) -> String? {
        endsAt.map { NoticeText.firstRecordingBody(endsAt: PlanText.day($0)) }
    }

    /// What stops when a trial ends.
    nonisolated static let loses = [NoticeText.losePlayback, NoticeText.loseRecording, NoticeText.loseScans]

    var body: some View {
        #if os(macOS)
            Group {
                if notice == .firstRecording {
                    macFirstRecording
                } else {
                    macTrial
                }
            }
            .shellSheet()
        #else
            Group {
                if notice == .firstRecording {
                    firstRecording
                } else {
                    trial
                }
            }
            .presentationDetents([.medium, .large])
            .shellSheet()
        #endif
    }

    #if os(macOS)
        // MARK: Mac

        /// See your plan beside OK, which Return and Escape both press.
        static func macFirstRecordingFooter(
            onClose: @escaping @MainActor () -> Void, onSeePlan: @escaping @MainActor () -> Void
        ) -> MacSheetFooter {
            MacSheetFooter(
                secondary: MacSheetAction(PlanText.seePlan, role: .secondary, isDefault: false, action: onSeePlan),
                primary: MacSheetAction(NoticeText.ok, action: onClose), escape: onClose)
        }

        /// Close, then Compare plans, then the offer's primary trailing. Subscribe never takes
        /// Return. Once a purchase settles, Close alone takes both keys.
        static func macTrialFooter(
            _ offer: Offer, isWorking: Bool, onClose: @escaping @MainActor () -> Void,
            onComparePlans: @escaping @MainActor () -> Void, onSubscribe: @escaping @MainActor () -> Void
        ) -> MacSheetFooter {
            if offer.primary == .close {
                return MacSheetFooter(primary: MacSheetAction(PlanSheet.close, action: onClose), escape: onClose)
            }
            let action = { (action: Action, role: MacButtonStyle.Role) -> MacSheetAction in
                switch action {
                case .subscribe(let price):
                    .subscribe(title: NoticeText.subscribeAnnual(price), isEnabled: !isWorking, action: onSubscribe)
                case .waiting:
                    .subscribe(title: PlanText.subscribe, isEnabled: false) {}
                case .comparePlans:
                    MacSheetAction(
                        PlanText.comparePlans, role: role, isDefault: action.isDefault, action: onComparePlans)
                case .close:
                    MacSheetAction(PlanSheet.close, role: role, isDefault: action.isDefault, action: onClose)
                }
            }
            return MacSheetFooter(
                cancel: .cancel(PlanSheet.close, action: onClose),
                secondary: offer.secondary.map { action($0, .secondary) },
                primary: action(offer.primary, .primary))
        }

        private var macFirstRecording: some View {
            let footer = Self.macFirstRecordingFooter(onClose: onClose, onSeePlan: onSeePlan)
            return MacSheet(
                title: Self.title(notice, endsAt: endsAt), style: .notice, size: .fitted(.standard),
                cancel: footer.cancel,
                secondary: footer.secondary, primary: footer.primary, escape: footer.escape
            ) {
                if let message = Self.firstRecordingBody(endsAt: endsAt) {
                    Text(message)
                        .font(MacStyle.body)
                        .foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }

        private var macTrial: some View {
            let line = tried ? purchase?.line : nil
            let sells = Self.sells(notice, plan: plan, purchase: purchase)
            let offer = Self.offer(sells: sells, offers: purchase?.offers, line: line)
            let lineText = offer.outcome(line)
            let footer = Self.macTrialFooter(
                offer, isWorking: purchase?.isWorking ?? true, onClose: onClose, onComparePlans: onComparePlans,
                onSubscribe: subscribe)
            return MacSheet(
                title: Self.title(notice, endsAt: endsAt),
                subtitle: Self.subtitle(notice, endsAt: endsAt, now: now ?? Date()), style: .notice,
                size: .fitted(.standard), cancel: footer.cancel,
                secondary: footer.secondary, primary: footer.primary, escape: footer.escape
            ) {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Self.loses, id: \.self) { lose in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: "xmark")
                                    .foregroundStyle(Palette.inkSecondary)
                                    .accessibilityHidden(true)
                                Text(lose)
                            }
                        }
                    }
                    Text(NoticeText.keeps)
                    if let lineText {
                        Text(lineText)
                    }
                    if let price = offer.annualPrice {
                        RenewalTerms(price: price, period: .annual)
                    }
                }
                .font(MacStyle.body)
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            }
            .task(id: PlanSheet.OfferAsk(sells: sells, offline: purchase?.isOffline)) {
                guard sells else { return }
                await purchase?.loadOffers()
            }
        }
    #endif

    #if !os(macOS)
        private func heading(_ text: String) -> some View {
            Text(text)
                .font(.platform(.title2).bold())
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
        }

        // MARK: First recording

        private var firstRecording: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    heading(Self.title(notice, endsAt: endsAt))
                    if let message = Self.firstRecordingBody(endsAt: endsAt) {
                        Text(message)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !PageStyle.pinsSheetActions {
                        HStack {
                            seePlan
                            Spacer()
                            ok.buttonStyle(.accentProminent)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .sheetActions {
                ok
            } secondary: {
                seePlan
            }
            .background {
                // Escape counts as OK, while Return stays on the visible OK.
                Button(NoticeText.ok, action: onClose)
                    .keyboardShortcut(.cancelAction)
                    .hidden()
                    .accessibilityHidden(true)
            }
        }

        private var ok: some View {
            Button(NoticeText.ok, action: onClose)
                .keyboardShortcut(.defaultAction)
        }

        private var seePlan: some View {
            Button(PlanText.seePlan, action: onSeePlan)
        }

        // MARK: Trial notices

        private var trial: some View {
            let line = tried ? purchase?.line : nil
            let sells = Self.sells(notice, plan: plan, purchase: purchase)
            let offer = Self.offer(sells: sells, offers: purchase?.offers, line: line)
            let lineText = offer.outcome(line)
            return NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 6) {
                            heading(Self.title(notice, endsAt: endsAt))
                            if let daysLeft = Self.subtitle(notice, endsAt: endsAt, now: now ?? Date()) {
                                Text(daysLeft)
                                    .foregroundStyle(.inkSecondary)
                            }
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Self.loses, id: \.self) { lose in
                                Label {
                                    Text(lose).fixedSize(horizontal: false, vertical: true)
                                } icon: {
                                    Image(systemName: "xmark").foregroundStyle(.inkSecondary)
                                }
                            }
                        }
                        Text(NoticeText.keeps)
                            .fixedSize(horizontal: false, vertical: true)
                        if !PageStyle.pinsSheetActions {
                            inlineActions(offer, line: lineText)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .sheetActions(line: lineText) {
                    primary(offer.primary)
                } secondary: {
                    if let secondary = offer.secondary {
                        button(secondary)
                    }
                } footer: {
                    if let price = offer.annualPrice {
                        RenewalTerms(price: price, period: .annual)
                    }
                }
                #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        SheetCloseButton(PlanSheet.close, action: onClose)
                            .keyboardShortcut(.cancelAction)
                    }
                }
            }
            // Asks once the notice may sell, and again when the connection comes back.
            .task(id: PlanSheet.OfferAsk(sells: sells, offline: purchase?.isOffline)) {
                guard sells else { return }
                await purchase?.loadOffers()
            }
        }

        /// The actions in the sheet's own content, where they do not pin to its bottom edge. Once a
        /// purchase settles, the toolbar's Close is the one way out.
        @ViewBuilder
        private func inlineActions(_ offer: Offer, line: String?) -> some View {
            if let line {
                Text(line).fixedSize(horizontal: false, vertical: true)
            }
            if offer.primary != .close {
                HStack {
                    if let secondary = offer.secondary {
                        button(secondary)
                    }
                    Spacer()
                    primary(offer.primary)
                        .buttonStyle(.accentProminent)
                }
            }
            if let price = offer.annualPrice {
                RenewalTerms(price: price, period: .annual)
            }
        }

        private func primary(_ action: Action) -> some View {
            button(action).keyboardShortcut(action.isDefault ? .defaultAction : nil)
        }

        @ViewBuilder
        private func button(_ action: Action) -> some View {
            switch action {
            case .subscribe(let price):
                Button(NoticeText.subscribeAnnual(price), action: subscribe)
                    .disabled(purchase?.isWorking ?? true)
            case .waiting:
                WaitingSubscribeButton()
            case .comparePlans:
                Button(PlanText.comparePlans, action: onComparePlans)
            case .close:
                Button(PlanSheet.close, action: onClose)
            }
        }

    #endif

    private func subscribe() {
        guard let purchase, let entry = Self.entry(notice) else { return }
        tried = true
        Task { await Self.subscribe(purchase, from: entry) }
    }
}

/// Compare plans' way from a notice to the Plan sheet, and See your plan's to Settings, which a
/// compact window shows in a sheet. Each is held until the notice's sheet has gone, since a sheet
/// asked for while another is leaving does not show.
@MainActor
@Observable
final class CompareHandoff {
    private(set) var entry: PremiumEntry?
    private(set) var seesPlan = false

    /// Whether a way out of the notice is held, which covers the shell so the next notice waits.
    var isHolding: Bool { entry != nil || seesPlan }

    /// Holds `entry` before the notice is dismissed, so the cover never lets go in between.
    func compare(_ entry: PremiumEntry?, dismiss: @MainActor () -> Void) {
        self.entry = entry
        dismiss()
    }

    /// Once the notice has gone, opens Settings for a held See your plan, or the Plan sheet for
    /// the held entry, then lets go. The next sheet's request holds the menus before the cover
    /// lets go; the record slot returns until that sheet appears and claims it.
    func noticeLeft(open: @MainActor (PremiumEntry) -> Void, seePlan: @MainActor () -> Void) {
        if seesPlan {
            seePlan()
            seesPlan = false
        }
        guard let entry else { return }
        open(entry)
        self.entry = nil
    }

    /// Holds See your plan before the notice is dismissed, as ``compare(_:dismiss:)`` holds its entry.
    func seePlan(dismiss: @MainActor () -> Void) {
        seesPlan = true
        dismiss()
    }
}

/// Presents the plan notice the model shows. Swiping it away or pressing Escape marks it seen.
struct NoticeSheets: ViewModifier {
    let model: NoticeModel?
    let plan: Plan
    /// Nil in a build that offers no purchase. The Plan sheet shares it.
    let purchase: PurchaseModel?
    let onSeePlan: @MainActor () -> Void
    /// Opens the Plan sheet for the plan, from the notice's entry.
    let onComparePlans: @MainActor (PremiumEntry) -> Void

    @State private var handoff = CompareHandoff()

    /// One showing of the notice, for `sheet(item:)`.
    private struct Showing: Identifiable {
        let notice: PlanNotice
        var id: PlanNotice { notice }
    }

    func body(content: Content) -> some View {
        content
            // Covers the shell while the handoff holds, so the next notice waits.
            .coversShell(handoff.isHolding)
            .sheet(item: shown, onDismiss: openPlan) { showing in
                NoticeSheet(
                    notice: showing.notice, endsAt: model?.trialEndsAt, plan: plan, purchase: purchase,
                    onClose: { model?.dismiss() },
                    onSeePlan: { handoff.seePlan { model?.dismiss() } },
                    onComparePlans: {
                        handoff.compare(NoticeSheet.entry(showing.notice)) { model?.dismiss() }
                    })
            }
    }

    private func openPlan() {
        handoff.noticeLeft(open: onComparePlans, seePlan: onSeePlan)
    }

    private var shown: Binding<Showing?> {
        Binding {
            model?.showing.map(Showing.init)
        } set: {
            if $0 == nil { model?.dismiss() }
        }
    }
}
