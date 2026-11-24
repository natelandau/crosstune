#if os(iOS)
    import AppIntents
    import CrosstuneShare
    import CrosstuneWidgetData

    /// A query that offers one kind of entity from the summary file the app writes, since the
    /// extension has no database. A list, recording, or tune missing from it, such as one deleted
    /// since, is not offered. Each query says only which of the summary's items it offers.
    public protocol WidgetSummaryEntityQuery: EntityQuery where Entity.ID == String {
        /// Nil in a build without the App Group, which offers nothing.
        var container: ShareContainer? { get }
        init(container: ShareContainer?)
        /// The summary's entities of this kind, each once.
        static func entities(in summary: WidgetSummary) -> [Entity]
    }

    extension WidgetSummaryEntityQuery {
        public init() { self.init(container: .appGroup()) }

        public func entities(for identifiers: [String]) async throws -> [Entity] {
            try await suggestedEntities().filter { identifiers.contains($0.id) }
        }

        public func suggestedEntities() async throws -> [Entity] {
            guard let container, case .available(let summary) = WidgetSummaryFile.readCurrent(in: container) else {
                return []
            }
            return Self.entities(in: summary)
        }
    }

    public struct ListEntity: AppEntity {
        public static let typeDisplayRepresentation: TypeDisplayRepresentation = "List"
        public static let defaultQuery = ListEntityQuery()

        public let id: String
        public let name: String

        public init(id: String, name: String) {
            self.id = id
            self.name = name
        }

        public var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
    }

    public struct ListEntityQuery: WidgetSummaryEntityQuery {
        public typealias Entity = ListEntity

        public let container: ShareContainer?

        public init(container: ShareContainer?) { self.container = container }

        public static func entities(in summary: WidgetSummary) -> [ListEntity] {
            summary.lists.map { ListEntity(id: $0.id, name: $0.name) }
        }
    }

    public struct RecordingEntity: AppEntity {
        public static let typeDisplayRepresentation: TypeDisplayRepresentation = "Recording"
        public static let defaultQuery = RecordingEntityQuery()

        public let id: String
        public let title: String

        public init(id: String, title: String) {
            self.id = id
            self.title = title
        }

        public var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
    }

    public struct RecordingEntityQuery: WidgetSummaryEntityQuery {
        public typealias Entity = RecordingEntity

        public let container: ShareContainer?

        public init(container: ShareContainer?) { self.container = container }

        public static func entities(in summary: WidgetSummary) -> [RecordingEntity] {
            summary.recordings.map { RecordingEntity(id: $0.id, title: $0.title) }
        }
    }

    public struct TuneEntity: AppEntity {
        public static let typeDisplayRepresentation: TypeDisplayRepresentation = "Tune"
        public static let defaultQuery = TuneEntityQuery()

        public let id: String
        public let title: String

        public init(id: String, title: String) {
            self.id = id
            self.title = title
        }

        public var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
    }

    /// Offers the tunes in the summary's lists, each once.
    public struct TuneEntityQuery: WidgetSummaryEntityQuery {
        public typealias Entity = TuneEntity

        public let container: ShareContainer?

        public init(container: ShareContainer?) { self.container = container }

        public static func entities(in summary: WidgetSummary) -> [TuneEntity] {
            var seen: Set<String> = []
            return summary.lists.flatMap(\.tunes)
                .filter { seen.insert($0.id).inserted }
                .map { TuneEntity(id: $0.id, title: $0.title) }
        }
    }
#endif
