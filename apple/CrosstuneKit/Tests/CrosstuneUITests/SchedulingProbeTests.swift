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
            printMainThreadStack()
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

    /// How long `schedule`'s work took to run, or -1 when it did not run within 60 seconds. Work
    /// still waiting after 1.5 seconds gets the main thread's stack printed, to show what holds it.
    private static func waitMilliseconds(_ schedule: (DispatchSemaphore) -> Void) -> Int {
        let done = DispatchSemaphore(value: 0)
        let start = DispatchTime.now()
        schedule(done)
        if done.wait(timeout: .now() + 1.5) != .success {
            printMainThreadStack()
            guard done.wait(timeout: .now() + 60) == .success else { return -1 }
        }
        return Int((DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
    }

    /// Samples this process for one second and prints the main thread's frames from this project.
    private static func printMainThreadStack() {
        let sampler = Process()
        sampler.executableURL = URL(fileURLWithPath: "/usr/bin/sample")
        sampler.arguments = [String(ProcessInfo.processInfo.processIdentifier), "1", "-mayDie"]
        let output = Pipe()
        sampler.standardOutput = output
        let errors = Pipe()
        sampler.standardError = errors
        do {
            try sampler.run()
        } catch {
            log("sample could not start: \(error)")
            return
        }
        let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        sampler.waitUntilExit()
        let errorText = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        log("sample exited \(sampler.terminationStatus), \(text.count) bytes; stderr: \(errorText.prefix(300))")
        // The main thread's header reads "Main Thread" in a test process. Each frame line starts
        // with the number of samples that hit it; keep the busiest frame lines from this project.
        var inMain = false
        var frames: [(count: Int, frame: String)] = []
        for line in text.split(separator: "\n") {
            if line.contains("Thread_") { inMain = line.contains("Main Thread") || line.contains("main-thread") }
            guard inMain, line.contains("(in Crosstune"), line.contains(".swift:") else { continue }
            let trimmed = line.drop { " +!:|".contains($0) }
            guard let space = trimmed.firstIndex(of: " "), let count = Int(trimmed[..<space]) else { continue }
            frames.append((count, String(trimmed[space...].trimmingCharacters(in: .whitespaces).prefix(200))))
        }
        var seen = Set<String>()
        let top = frames.sorted { $0.count > $1.count }.filter { seen.insert($0.frame).inserted }.prefix(15)
        log("main thread stack begin")
        for entry in top { log("  \(entry.count) \(entry.frame)") }
        log("main thread stack end")
    }
}
