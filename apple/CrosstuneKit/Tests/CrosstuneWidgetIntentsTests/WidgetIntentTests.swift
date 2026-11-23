#if os(iOS)
    import AppIntents
    import Testing

    @testable import CrosstuneWidgetIntents

    @MainActor
    struct WidgetIntentTests {
        struct ForegroundCase: Sendable, CustomTestStringConvertible {
            let testDescription: String
            let expected: WidgetRequest
            let perform: @MainActor @Sendable (WidgetRequestInbox) async throws -> Void
        }

        private nonisolated static let list = ListEntity(id: "list_1", name: "Session")

        nonisolated static let foregroundCases: [ForegroundCase] = [
            ForegroundCase(testDescription: "start recording", expected: .record) { inbox in
                var intent = StartRecordingIntent()
                intent.inbox = inbox
                _ = try await intent.perform()
            },
            ForegroundCase(testDescription: "play recording", expected: .playRecording(id: "rec_1")) { inbox in
                var intent = PlayRecordingIntent(recording: RecordingEntity(id: "rec_1", title: "Kesh"))
                intent.inbox = inbox
                _ = try await intent.perform()
            },
            ForegroundCase(testDescription: "play list shuffled", expected: .playList(id: "list_1", shuffled: true)) {
                inbox in
                var intent = PlayListIntent(list: list, shuffled: true)
                intent.inbox = inbox
                _ = try await intent.perform()
            },
            ForegroundCase(testDescription: "play list in order", expected: .playList(id: "list_1", shuffled: false)) {
                inbox in
                var intent = PlayListIntent(list: list, shuffled: false)
                intent.inbox = inbox
                _ = try await intent.perform()
            },
            ForegroundCase(
                testDescription: "play list from tune", expected: .playListFromTune(id: "list_1", tuneID: "tune_1")
            ) { inbox in
                var intent = PlayListFromTuneIntent(list: list, tune: TuneEntity(id: "tune_1", title: "Kesh"))
                intent.inbox = inbox
                _ = try await intent.perform()
            },
            ForegroundCase(testDescription: "open list", expected: .openList(id: "list_1")) { inbox in
                var intent = OpenListIntent(list: list)
                intent.inbox = inbox
                _ = try await intent.perform()
            },
            ForegroundCase(testDescription: "open tuner", expected: .openTuner) { inbox in
                var intent = OpenTunerIntent()
                intent.inbox = inbox
                _ = try await intent.perform()
            },
            ForegroundCase(testDescription: "open plan", expected: .openPlan) { inbox in
                var intent = OpenPlanIntent()
                intent.inbox = inbox
                _ = try await intent.perform()
            },
            ForegroundCase(testDescription: "open app", expected: .openApp) { inbox in
                var intent = OpenAppIntent()
                intent.inbox = inbox
                _ = try await intent.perform()
            },
        ]

        @Test(arguments: foregroundCases)
        func foregroundIntentPostsItsRequest(_ testCase: ForegroundCase) async throws {
            let inbox = WidgetRequestInbox()
            try await testCase.perform(inbox)
            #expect(inbox.pending == testCase.expected)
        }

        enum PlaybackCall: Sendable { case pause, resume }

        @MainActor
        final class FakePlaybackControl: WidgetPlaybackControl {
            var calls: [PlaybackCall] = []
            func pauseList() async { calls.append(.pause) }
            func resumeList() async { calls.append(.resume) }
        }

        @Test(arguments: [PlaybackCall.pause, .resume])
        func pauseAndResumeCallTheControl(_ call: PlaybackCall) async throws {
            let control = FakePlaybackControl()
            switch call {
            case .pause:
                var intent = PauseListIntent(dependencies: AppDependencyManager())
                intent.control = control
                _ = try await intent.perform()
            case .resume:
                var intent = ResumeListIntent(dependencies: AppDependencyManager())
                intent.control = control
                _ = try await intent.perform()
            }
            #expect(control.calls == [call])
        }
    }
#endif
