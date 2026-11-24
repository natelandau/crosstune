import CrosstunePalette
import CrosstuneWidgetData
import CrosstuneWidgetIntents
import SwiftUI
import WidgetKit

/// The widgets' own words. The Recordings and List widgets show the rest.
enum WidgetText {
    static let appName = "Crosstune"
    static let signIn = "Sign in to Crosstune"
    static let noRecordings = "No recordings yet"
    static let noRecordingsHint = "Recordings you make show here"
    static let needsPremium = "Recordings need Premium"
    static let needsPremiumHint = "Tap to see plans"
    static let recentRecordings = "Recent recordings"
    static let tapToPlay = "Tap to play"
    static let emptyList = "No tunes in this list"
    static let chooseList = "Choose a list"
    static let chooseListHint = "Touch and hold to edit the widget"
    static let playing = "Playing"
    static let previousPage = "Previous page"
    static let nextPage = "Next page"

    /// "2 of 12": a place among a count, for the playing tune and for the page.
    static func position(_ position: Int, of count: Int) -> String {
        "\(position) of \(count)"
    }
}

/// A widget's content for whoever is signed in: `content` with the summary, or a message that
/// opens the app when there is none to show.
struct SummaryContent<Content: View>: View {
    let current: CurrentWidgetSummary
    @ViewBuilder let content: (WidgetSummary) -> Content

    var body: some View {
        switch current {
        case .signedOut: OpenAppMessage(text: WidgetText.signIn)
        // Signed in, but the summary is not written yet or cannot be read. The app writes it
        // again once it opens.
        case .unavailable: OpenAppMessage(text: WidgetText.appName)
        case .available(let summary): content(summary)
        }
    }
}

/// A message that fills the widget at every size. A tap opens the app.
struct OpenAppMessage: View {
    let text: String

    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetContentMargins) private var contentMargins

    private var isAccessory: Bool {
        family == .accessoryCircular || family == .accessoryRectangular || family == .accessoryInline
    }

    var body: some View {
        Button(intent: OpenAppIntent()) {
            message
                .font(isAccessory ? .caption.bold() : .subheadline.bold())
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, isAccessory ? 2 : 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(family == .accessoryRectangular ? contentMargins : EdgeInsets())
        .containerBackground(for: .widget) {
            switch family {
            // A lock screen rectangle draws its text straight on the wallpaper, as the system's do.
            case .accessoryRectangular: Color.clear
            case .accessoryCircular, .accessoryInline: AccessoryWidgetBackground()
            default: Palette.pageBackground
            }
        }
    }

    /// On the lock screen, iOS draws in one tint over the wallpaper, so the text keeps the
    /// system's foreground.
    @ViewBuilder private var message: some View {
        if isAccessory {
            Text(text)
        } else {
            Text(text).foregroundStyle(Palette.textPrimary)
        }
    }
}
