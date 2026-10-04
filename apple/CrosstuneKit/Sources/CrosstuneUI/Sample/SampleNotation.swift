#if DEBUG
    import CoreGraphics
    import CrosstuneCommands
    import CrosstuneStore
    import Foundation

    /// Notation pages for the sample catalog, drawn on the spot rather than shipped: staves with
    /// a scatter of note heads, enough to tell one page from another.
    enum SampleNotation {
        /// Gives the first sample tune three pages, and the second one page the server refused
        /// for quota, so the section shows both a clean row and a marked page.
        static func add(to store: CrosstuneStore) async throws {
            let commands = Commands(store: store)
            let first = SampleCatalog.entries[0].tune.id
            let second = SampleCatalog.entries[1].tune.id
            let pages = try await Task.detached { try (1...3).map { try PreparedPage.make(from: page(seed: $0)) } }
                .value
            try await commands.addNotationPages(tuneID: first, pages: pages)
            let marked = try await commands.addNotationPages(tuneID: second, pages: [pages[0]])
            try await store.write { writer in
                guard var file = try NotationFile.fetchOne(writer.db, key: marked[0]) else { return }
                file.error = NotationFile.storageFullError
                try file.update(writer.db)
            }
        }

        private static func page(seed: Int) -> CGImage {
            let width = 1700
            let height = 2200
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
            context.setFillColor(CGColor(srgbRed: 0.98, green: 0.97, blue: 0.94, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
            context.setStrokeColor(CGColor(srgbRed: 0.1, green: 0.1, blue: 0.1, alpha: 1))
            context.setFillColor(CGColor(srgbRed: 0.1, green: 0.1, blue: 0.1, alpha: 1))
            context.setLineWidth(4)
            var generator = SeededGenerator(seed: UInt64(seed))
            let gap = 24
            for system in 0..<8 {
                let top = height - 260 - system * 240
                for line in 0..<5 {
                    let y = CGFloat(top - line * gap)
                    context.move(to: CGPoint(x: 140, y: y))
                    context.addLine(to: CGPoint(x: CGFloat(width - 140), y: y))
                }
                context.strokePath()
                for beat in 0..<16 {
                    let x = CGFloat(220 + beat * 82)
                    let step = Int(generator.next() % 9)
                    let y = CGFloat(top - 4 * gap + step * gap / 2)
                    context.fillEllipse(in: CGRect(x: x - 16, y: y - 12, width: 32, height: 24))
                    context.move(to: CGPoint(x: x + 14, y: y))
                    context.addLine(to: CGPoint(x: x + 14, y: y + 80))
                    context.strokePath()
                }
            }
            // The page number, so a reorder shows which page went where.
            for mark in 0..<seed {
                let x = width / 2 - seed * 30 + mark * 60
                context.fillEllipse(in: CGRect(x: x, y: 90, width: 36, height: 36))
            }
            return context.makeImage()!
        }
    }

    /// A small fixed-seed generator, so the sample pages draw the same every launch.
    private struct SeededGenerator {
        private var state: UInt64

        init(seed: UInt64) {
            state = seed &* 0x9E37_79B9_7F4A_7C15
        }

        mutating func next() -> UInt64 {
            state ^= state << 13
            state ^= state >> 7
            state ^= state << 17
            return state
        }
    }
#endif
