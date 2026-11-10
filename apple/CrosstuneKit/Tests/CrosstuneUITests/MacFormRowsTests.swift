#if os(macOS)
    import AppKit
    import CrosstuneDesign
    import SwiftUI
    import Testing

    @MainActor private final class LeadingEdges {
        var seen: [String: CGFloat] = [:]
    }

    private struct EdgeProbe: ViewModifier {
        let name: String
        let box: LeadingEdges

        func body(content: Content) -> some View {
            content.onGeometryChange(for: CGFloat.self) {
                $0.frame(in: .named("card")).minX
            } action: { x in
                box.seen[name] = x
            }
        }
    }

    @MainActor @Suite struct MacFormRowsTests {
        private func edges(_ rows: (LeadingEdges) -> some View) -> [String: CGFloat] {
            let box = LeadingEdges()
            let root = MacFormSection { rows(box) }
                .coordinateSpace(.named("card"))
                .frame(width: 400)
            let host = NSHostingView(rootView: root)
            let window = hiddenWindow(size: CGSize(width: 400, height: 300), styleMask: [], appearance: .aqua)
            defer { window.close() }
            window.contentView = host
            for _ in 0..<5 {
                host.layoutSubtreeIfNeeded()
                RunLoop.main.run(until: .now)
            }
            return box.seen
        }

        /// A pressable row's text starts where a value row's does in the same card, so the rows'
        /// text and the hairlines inset to it line up.
        @Test func aPressableRowsTextLinesUpWithAValueRows() {
            let seen = edges { box in
                Group {
                    LabeledContent {
                        Text(verbatim: "Value")
                    } label: {
                        Text(verbatim: "Setting").modifier(EdgeProbe(name: "value", box: box))
                    }
                    Button {
                    } label: {
                        Text(verbatim: "Opens more").modifier(EdgeProbe(name: "pressable", box: box))
                    }
                    .buttonStyle(.macRow)
                    DisclosureRowButton(action: {}) {
                        LabeledContent {
                            Text(verbatim: "Summary")
                        } label: {
                            Text(verbatim: "Opens a sheet").modifier(EdgeProbe(name: "disclosure", box: box))
                        }
                    }
                }
            }
            #expect(seen["value"] != nil)
            #expect(seen["pressable"] == seen["value"])
            #expect(seen["disclosure"] == seen["value"])
        }
    }
#endif
