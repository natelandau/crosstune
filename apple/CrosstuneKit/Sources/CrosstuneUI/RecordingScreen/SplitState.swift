import CrosstuneStore
import Foundation

/// The Split screen's rules as values: the cuts and the line, and what each action does to them.
/// Mirrors the web's `splitModel.ts`.
extension SplitModel {
    struct Piece: Equatable {
        let startMs: Int64
        let endMs: Int64

        var lengthMs: Int64 { endMs - startMs }
    }

    /// The cuts and the line, with the rules that move them.
    struct State: Equatable {
        /// The row's current trim, which the cuts cannot leave.
        var lowMs: Int64
        var highMs: Int64
        var lineMs: Int64
        /// Ascending.
        var cuts: [Int64]
        /// Index into `cuts` of the cut the line moves.
        var selected: Int?
        /// The whole range is over the upload limit, so every piece must fit it.
        var overLimit: Bool

        init(
            lowMs: Int64, highMs: Int64, lineMs: Int64, cuts: [Int64] = [], selected: Int? = nil,
            overLimit: Bool
        ) {
            self.lowMs = lowMs
            self.highMs = highMs
            self.lineMs = lineMs
            self.cuts = cuts
            self.selected = selected
            self.overLimit = overLimit
        }

        enum Action {
            case moveLine(Int64)
            case nudge(Int64)
            /// Moves the line alone, letting go of a selected cut.
            case seek(Int64)
            /// The line has stopped; one resting exactly on a cut selects it.
            case rest
            case addCut
            case removeCut
            case select(Int)
            case previous
            case next
            /// Moves cut `index` alone, as its handle does, leaving the line where it is.
            case moveCut(index: Int, ms: Int64)
        }

        var canAddCut: Bool {
            guard selected == nil, cuts.count + 1 < RecordingLimits.maxSplitPieces else { return false }
            let room = cutRoom(for: nil)
            return lineMs >= room.min && lineMs <= room.max
        }

        var pieces: [Piece] {
            let edges = [lowMs] + cuts + [highMs]
            return zip(edges, edges.dropFirst()).map { Piece(startMs: $0, endMs: $1) }
        }

        /// The loop color slot piece `index` is drawn in, cycling through every slot so
        /// neighbors always differ.
        static func pieceColor(_ index: Int) -> Int {
            LoopModel.colorOrder[index % LoopModel.colorCount]
        }

        var canSave: Bool {
            !cuts.isEmpty && RecordingLimits.pieceProblem(edges: [lowMs] + cuts + [highMs]) == nil
        }

        /// The index of the piece holding `ms`; a cut belongs to the piece it starts.
        func pieceIndex(at ms: Int64) -> Int {
            cuts.count { $0 <= ms }
        }

        func applying(_ action: Action) -> State {
            var next = self
            switch action {
            case .moveLine(let ms): next.move(to: ms)
            case .nudge(let ms): next.move(to: lineMs + ms)
            case .seek(let ms):
                next.selected = nil
                next.move(to: ms)
            case .rest:
                if selected == nil, let at = cuts.firstIndex(of: lineMs) { next.selected = at }
            case .addCut:
                guard canAddCut else { return self }
                next.cuts = (cuts + [lineMs]).sorted()
                next.selected = next.cuts.firstIndex(of: lineMs)
            case .removeCut:
                guard let selected else { return self }
                next.cuts.remove(at: selected)
                next.selected = nil
            case .select(let index):
                next.select(index)
            case .previous:
                let from = selected ?? cuts.count { $0 < lineMs }
                if from > 0 { next.select(from - 1) }
            case .next:
                let from = selected.map { $0 + 1 } ?? cuts.firstIndex { $0 > lineMs } ?? cuts.count
                if from < cuts.count { next.select(from) }
            case .moveCut(let index, let ms):
                guard cuts.indices.contains(index) else { return self }
                let room = cutRoom(for: index)
                guard room.min <= room.max else { return self }
                let cut = min(max(ms, room.min), room.max)
                guard cut != cuts[index] else { return self }
                next.cuts[index] = cut
                // A selected cut holds the line on it, so moving it away lets it go.
                if selected == index { next.selected = nil }
            }
            return next
        }

        /// The range cut `index`, or a new cut when nil, may sit in, so every piece stays at
        /// least ``RecordingLimits/minLengthMs`` long.
        func cutRoom(for index: Int?) -> (min: Int64, max: Int64) {
            let at = index ?? cuts.count { $0 <= lineMs }
            let before = at == 0 ? lowMs : cuts[at - 1]
            let afterIndex = index == nil ? at : at + 1
            let after = afterIndex < cuts.count ? cuts[afterIndex] : highMs
            return (before + RecordingLimits.minLengthMs, after - RecordingLimits.minLengthMs)
        }

        private mutating func move(to ms: Int64) {
            guard let selected else {
                lineMs = min(max(ms, lowMs), highMs)
                return
            }
            let room = cutRoom(for: selected)
            guard room.min <= room.max else { return }
            let cut = min(max(ms, room.min), room.max)
            cuts[selected] = cut
            lineMs = cut
        }

        private mutating func select(_ index: Int) {
            guard cuts.indices.contains(index) else { return }
            selected = index
            lineMs = cuts[index]
        }
    }
}
