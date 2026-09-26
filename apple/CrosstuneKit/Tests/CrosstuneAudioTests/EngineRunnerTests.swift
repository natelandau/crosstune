import Foundation
import Synchronization
import Testing

@testable import CrosstuneAudio

@MainActor
@Suite struct EngineRunnerTests {
    @Test func queuesWorkInTheOrderTheMainActorAskedForIt() async {
        let log = Mutex<[String]>([])
        let queue = DispatchQueue(label: "engine-runner-test")
        // Held, so nothing queued can run ahead and every step sits in line until checked.
        queue.suspend()
        let runner = EngineRunner(queue: queue, onEnqueue: { name in log.withLock { $0.append(name) } })

        let activate = Task { try? await runner.activateSession() }
        let stop = Task { await runner.stopEngine() }
        let deactivate = Task { await runner.deactivateSession() }
        while log.withLock({ $0.count }) < 3 { await Task.yield() }

        #expect(log.withLock { $0 } == ["activate", "stop", "deactivate"])
        queue.resume()
        _ = await (activate.value, stop.value, deactivate.value)
    }
}
