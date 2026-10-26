import SwiftUI

/// Why the app asks for an account before anything else, with one way out.
struct AccountReasonSheet: View {
    @Environment(\.dismiss) private var dismiss
    #if !os(macOS)
        /// The body and Done's height, once measured.
        @State private var contentHeight: CGFloat?
        @State private var bottomInset: CGFloat = 0
    #endif

    var body: some View {
        #if os(macOS)
            MacSheet(
                title: WelcomeCopy.whyTitle, size: .fitted(.standard), cancel: nil,
                primary: MacSheetAction(WelcomeCopy.whyDone) { dismiss() }, escape: { dismiss() }
            ) {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(WelcomeCopy.whyBody, id: \.self) { paragraph in
                        Text(paragraph)
                    }
                }
                .font(MacStyle.body)
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            }
            .shellSheet()
        #else
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(WelcomeCopy.whyTitle)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(WelcomeCopy.whyBody, id: \.self) { paragraph in
                        Text(paragraph)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .onScrollGeometryChange(for: CGFloat.self) {
                $0.contentSize.height + $0.contentInsets.top + $0.contentInsets.bottom
            } action: { _, height in
                contentHeight = height
            }
            .sheetActions {
                Button(WelcomeCopy.whyDone) { dismiss() }
                    .keyboardShortcut(.defaultAction)
            } secondary: {
                EmptyView()
            }
            // A height detent leaves out the sheet's own bottom safe area, which the scroll
            // view's insets count.
            .onGeometryChange(for: CGFloat.self) {
                $0.safeAreaInsets.bottom
            } action: {
                bottomInset = $0
            }
            // Two short paragraphs, so the sheet opens at their height rather than leave a gap
            // above Done; a height past the screen's opens it full.
            .presentationDetents(contentHeight.map { [.height($0 - bottomInset)] } ?? [.medium])
            .shellSheet()
        #endif
    }
}

#Preview("Why an account") {
    AccountReasonSheet()
}
