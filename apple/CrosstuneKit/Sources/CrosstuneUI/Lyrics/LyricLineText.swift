import SwiftUI

#if os(iOS)
    import UIKit
#elseif os(macOS)
    import AppKit
#endif

/// One lyric line, its wrapped continuation indented about 1.25 character widths so it reads
/// apart from a new line. SwiftUI's `Text` ignores paragraph style, so a hanging indent needs a
/// platform label under a native paragraph style instead.
struct LyricLineText: View {
    let text: String
    let pointSize: CGFloat
    let lineSpacing: CGFloat

    var body: some View {
        LyricLinePlatformText(text: text, pointSize: pointSize, lineSpacing: lineSpacing)
    }
}

/// A line as one paragraph: the first row sits at the margin, and headIndent alone carries every
/// wrapped continuation, which is what a negative text-indent plus a matching padding-left does
/// on the web. `characterWidth` is the width of "0", the web's `ch` unit.
private func hangingIndentStyle(characterWidth: CGFloat, lineSpacing: CGFloat) -> NSMutableParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.headIndent = characterWidth * 1.25
    style.firstLineHeadIndent = 0
    style.lineSpacing = lineSpacing
    return style
}

#if os(iOS)
    private struct LyricLinePlatformText: UIViewRepresentable {
        let text: String
        let pointSize: CGFloat
        let lineSpacing: CGFloat

        func makeUIView(context: Context) -> UILabel {
            let label = UILabel()
            label.numberOfLines = 0
            label.backgroundColor = .clear
            return label
        }

        func updateUIView(_ label: UILabel, context: Context) {
            let font = UIFont.systemFont(ofSize: pointSize)
            let characterWidth = ("0" as NSString).size(withAttributes: [.font: font]).width
            label.attributedText = NSAttributedString(
                string: text,
                attributes: [
                    .font: font,
                    .paragraphStyle: hangingIndentStyle(characterWidth: characterWidth, lineSpacing: lineSpacing),
                ])
        }

        func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
            let width = proposal.width ?? uiView.intrinsicContentSize.width
            return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        }
    }
#elseif os(macOS)
    private struct LyricLinePlatformText: NSViewRepresentable {
        let text: String
        let pointSize: CGFloat
        let lineSpacing: CGFloat

        func makeNSView(context: Context) -> NSTextField {
            let field = NSTextField(wrappingLabelWithString: "")
            field.isEditable = false
            field.isBordered = false
            field.drawsBackground = false
            return field
        }

        func updateNSView(_ field: NSTextField, context: Context) {
            let font = NSFont.systemFont(ofSize: pointSize)
            let characterWidth = ("0" as NSString).size(withAttributes: [.font: font]).width
            field.attributedStringValue = NSAttributedString(
                string: text,
                attributes: [
                    .font: font,
                    .paragraphStyle: hangingIndentStyle(characterWidth: characterWidth, lineSpacing: lineSpacing),
                ])
        }

        func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSTextField, context: Context) -> CGSize? {
            nsView.preferredMaxLayoutWidth = proposal.width ?? 0
            return nsView.intrinsicContentSize
        }
    }
#endif
