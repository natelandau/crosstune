import CrosstuneDesign
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
    /// Makes sure the words can be selected and copied, as on the tune page. SwiftUI's text
    /// selection cannot reach a platform label, so the label itself is made selectable. False
    /// leaves the platform label's own default.
    var selectable = false

    var body: some View {
        LyricLinePlatformText(text: text, pointSize: pointSize, lineSpacing: lineSpacing, selectable: selectable)
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
    /// A label, or where the line is selectable a text view laid out as one: no editing, no
    /// scrolling, and no inset or padding, so both wrap and size alike.
    private struct LyricLinePlatformText: UIViewRepresentable {
        let text: String
        let pointSize: CGFloat
        let lineSpacing: CGFloat
        let selectable: Bool

        func makeUIView(context: Context) -> UIView {
            guard selectable else {
                let label = UILabel()
                label.numberOfLines = 0
                label.backgroundColor = .clear
                return label
            }
            let view = UITextView()
            view.isEditable = false
            view.isSelectable = true
            view.isScrollEnabled = false
            view.backgroundColor = .clear
            view.textContainerInset = .zero
            view.textContainer.lineFragmentPadding = 0
            return view
        }

        func updateUIView(_ view: UIView, context: Context) {
            let font = UIFont.systemFont(ofSize: pointSize)
            let characterWidth = ("0" as NSString).size(withAttributes: [.font: font]).width
            let line = NSAttributedString(
                string: text,
                attributes: [
                    .font: font,
                    // A text view draws attributed text without a color in black, unlike a label.
                    .foregroundColor: UIColor(Palette.textPrimary),
                    .paragraphStyle: hangingIndentStyle(characterWidth: characterWidth, lineSpacing: lineSpacing),
                ])
            if let label = view as? UILabel {
                label.attributedText = line
            } else if let textView = view as? UITextView {
                textView.attributedText = line
            }
        }

        func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIView, context: Context) -> CGSize? {
            let width = proposal.width ?? uiView.intrinsicContentSize.width
            return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        }
    }
#elseif os(macOS)
    private struct LyricLinePlatformText: NSViewRepresentable {
        let text: String
        let pointSize: CGFloat
        let lineSpacing: CGFloat
        let selectable: Bool

        func makeNSView(context: Context) -> NSTextField {
            let field = NSTextField(wrappingLabelWithString: "")
            field.isEditable = false
            if selectable { field.isSelectable = true }
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
                    // Attributed text without a color draws in black, whatever the appearance.
                    .foregroundColor: NSColor(Palette.textPrimary),
                    .paragraphStyle: hangingIndentStyle(characterWidth: characterWidth, lineSpacing: lineSpacing),
                ])
        }

        func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSTextField, context: Context) -> CGSize? {
            nsView.preferredMaxLayoutWidth = proposal.width ?? 0
            return nsView.intrinsicContentSize
        }
    }
#endif
