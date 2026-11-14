import CrosstuneAnalytics
import CrosstuneDesign
import SwiftUI

/// The Plan sheet that a page which does nothing without Premium draws over its body: the
/// context area and what the account can buy, with no way to close it. The page's header and
/// the app's navigation stay live around it, so leaving the page is the way out.
struct LapsedOverlay: View {
    /// The recording the page shows, as the page reads it, which the context names and exports.
    let subject: PremiumSubject
    /// Where a purchase from the overlay reports it was made.
    let entry: PremiumEntry
    /// The context's export action, which opens over the overlay.
    let onAction: (PlanContextAction) -> Void

    @Environment(\.plan) private var plan
    @Environment(\.analytics) private var analytics
    @Environment(\.purchase) private var purchase
    /// Whether this overlay has reported its showing. The page gives each recording its own
    /// overlay, so a page that shows again with the same overlay, as on a return from another
    /// tab, is not another showing, and each recording shown is.
    @State private var reported = false
    #if os(macOS)
        /// The frame's parts as last laid out, so it is as tall as its content up to the page's room.
        @State private var fitted = MacSheetFittedParts()
    #endif

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: PageStyle.surfaceRadius)
        // The page's recording is live while the page shows, so the context reads no store.
        let context = PlanContext.make(
            reason: .recordings, lapse: plan?.plan.lapse, inputs: PlanContextInputs(presuming: subject))
        let panel = PlanPanel(context: context, purchase: purchase, entry: entry, onAction: onAction, host: .overlay)
        Group {
            #if os(macOS)
                macFrame(panel, context: context)
            #else
                panel
            #endif
        }
        .clipShape(shape)
        .overlay { shape.strokeBorder(Palette.border) }
        .elevation(.float)
        .frame(maxWidth: PageStyle.overlayCardMaxWidth)
        .padding(PageStyle.pageMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear {
            guard !reported else { return }
            reported = true
            Self.reportShowing(from: entry, analytics: analytics, purchase: purchase)
        }
    }

    /// Reports a showing and readies the purchase for it, as a showing of the Plan sheet does.
    static func reportShowing(from entry: PremiumEntry, analytics: AnalyticsClient, purchase: PurchaseModel?) {
        purchase?.resetForShowing()
        analytics.send(.premiumSheetShown(reason: .recordings, from: entry, presentation: .overlay))
    }

    #if os(macOS)
        /// The closable sheet's Mac frame with no Close, and no Escape, which belongs to the page.
        private func macFrame(_ panel: PlanPanel, context: PlanContext) -> some View {
            let chrome = PlanPanel.macChrome(
                plan: plan?.plan ?? .unknown, context: context, purchase: purchase, entry: entry, close: nil)
            // No window to size and no opening focus, which would take focus from the page.
            return MacSheetChrome(
                title: chrome.title, subtitle: chrome.subtitle, style: .notice, cancel: chrome.footer.cancel,
                secondary: nil, primary: chrome.footer.primary, escape: chrome.footer.escape, fitted: $fitted,
                leading: restore(offered: chrome.offersRestore), accessory: EmptyView(), content: panel
            )
            .frame(maxHeight: fitted.height(max: .infinity))
            .background(Palette.pageBackground)
            .resetsSurfaceEnvironment()
        }

        @ViewBuilder
        private func restore(offered: Bool) -> some View {
            if let purchase, offered {
                RestorePurchasesButton(purchase: purchase)
            }
        }
    #endif
}
