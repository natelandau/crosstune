#if os(macOS)
    import CrosstuneStore
    import GRDB

    /// The counts beside the Mac sidebar's rows. They are absolute, ignoring every catalog filter,
    /// so a status row reads the same whatever the catalog column has narrowed to.
    public struct SidebarCounts: Equatable, Sendable {
        /// The tunes the catalog shows with archived ones hidden.
        public let catalog: Int
        /// Those tunes by status, a status this build does not know counted as want to learn,
        /// as its row shows it.
        public let byStatus: [String: Int]
        public let recordings: Int

        public init(catalog: Int, byStatus: [String: Int], recordings: Int) {
            self.catalog = catalog
            self.byStatus = byStatus
            self.recordings = recordings
        }

        /// Counts the same tunes the catalog lists: a live user row over a live shared tune.
        nonisolated static func fetch(_ db: Database) throws -> SidebarCounts {
            let rows = try Row.fetchAll(
                db,
                sql: """
                    SELECT u.status, COUNT(*) AS count
                    FROM \(UserTune.databaseTableName) u
                    JOIN \(Tune.databaseTableName) t ON t.id = u.tune_id AND t.deleted_at IS NULL
                    WHERE u.deleted_at IS NULL AND u.archived_at IS NULL
                    GROUP BY u.status
                    """)
            var byStatus: [String: Int] = [:]
            for row in rows {
                byStatus[StatusStyle.normalized(row["status"]), default: 0] += row["count"] as Int
            }
            return SidebarCounts(
                catalog: byStatus.values.reduce(0, +), byStatus: byStatus,
                recordings: try Recording.filter(Recording.CodingKeys.deletedAt == nil).fetchCount(db))
        }
    }
#endif
