import Dispatch
import Foundation
import Testing

/// Temporary: prints how long main-actor and thread-pool work waits to run during the test run.
@Suite struct SchedulingProbeTests {
    @Test func startsTheSchedulingProbe() {
        SchedulingProbe.start()
    }
}

enum SchedulingProbe {
    /// Writes one `DIAG` line stamped with the process uptime, which survives output buffering.
    static func log(_ text: String) {
        let line = String(format: "DIAG %.3f ", ProcessInfo.processInfo.systemUptime) + text + "\n"
        FileHandle.standardError.write(Data(line.utf8))
    }

    /// Samples once a second from its own thread, so a busy thread pool cannot delay the samples.
    static func start() {
        log("probe started activeProcessorCount=\(ProcessInfo.processInfo.activeProcessorCount)")
        Thread.detachNewThread {
            let began = Date()
            while Date().timeIntervalSince(began) < 150 {
                let main = waitMilliseconds { done in Task { @MainActor in done.signal() } }
                let pool = waitMilliseconds { done in Task.detached { done.signal() } }
                log("sample mainActorWaitMs=\(main) poolWaitMs=\(pool)")
                Thread.sleep(forTimeInterval: 1)
            }
            log("probe ended")
        }
    }

    /// How long `schedule`'s work took to run, or -1 when it did not run within 60 seconds.
    private static func waitMilliseconds(_ schedule: (DispatchSemaphore) -> Void) -> Int {
        let done = DispatchSemaphore(value: 0)
        let start = DispatchTime.now()
        schedule(done)
        guard done.wait(timeout: .now() + 60) == .success else { return -1 }
        return Int((DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
    }
}
