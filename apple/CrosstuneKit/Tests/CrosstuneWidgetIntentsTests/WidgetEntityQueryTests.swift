#if os(iOS)
    import CrosstuneShare
    import CrosstuneTestSupport
    import CrosstuneWidgetData
    import Testing

    @testable import CrosstuneWidgetIntents

    struct WidgetEntityQueryTests {
        let root = TemporaryRoot()

        @Test func aDeletedListIsNotOffered() async throws {
            let container = ShareContainer(root: try root.folder())
            let summary = WidgetSummary(
                recordingsPlay: true, recordings: [],
                lists: [WidgetList(id: "list_kept", name: "Session", tunes: [])],
                tunerReferenceLabel: nil, recording: nil, recordingFreshUntil: nil, listPlayback: nil)
            try WidgetSummaryFile.write(summary, userID: "user_a", in: container)
            try container.setCurrentUserID("user_a")

            let query = ListEntityQuery(container: container)
            #expect(try await query.entities(for: ["list_deleted"]).isEmpty)
        }
    }
#endif
