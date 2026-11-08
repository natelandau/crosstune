import CrosstuneDesign
import SwiftUI

#if os(macOS)
    /// The recording's title as the page's heading, with its date and length under it.
    struct RecordingPageHeader: View {
        let title: String
        let subtitle: String

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .contentMask()
                    .font(MacStyle.pageTitle)
                    .tracking(MacStyle.pageTitleTracking)
                    .lineLimit(2)
                    .accessibilityAddTraits(.isHeader)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .contentMask()
                        .font(MacStyle.body)
                        .monospacedDigit()
                        .foregroundStyle(.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, MacStyle.pageMargin)
            .padding(.top, MacStyle.headingGap)
        }
    }
#endif

#if os(iOS)
    /// The bar's title and subtitle, in place of the system's so they can carry .contentMask().
    struct RecordingPageBarHeader: View {
        let title: String
        let subtitle: String

        var body: some View {
            VStack(spacing: 0) {
                Text(title)
                    .contentMask()
                    .font(.headline)
                    .foregroundStyle(Palette.textPrimary)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .contentMask()
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(Palette.textSecondary)
                }
            }
            .lineLimit(1)
            // The bar's height is fixed, so the largest sizes show in the large content viewer.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityShowsLargeContentViewer()
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
        }
    }
#endif
