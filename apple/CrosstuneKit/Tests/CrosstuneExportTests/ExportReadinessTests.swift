import Foundation
import Testing

@testable import CrosstuneExport

private let file = URL(filePath: "/tmp/recording.m4a")

private struct ReadinessCase: Sendable, CustomTestStringConvertible {
    let name: String
    let state: String
    let hasFile: Bool
    let isCapturing: Bool
    let online: Bool
    let expected: ExportReadiness
    var testDescription: String { name }
}

private let readinessCases: [ReadinessCase] = [
    .init(
        name: "capturing with a file", state: "pending_upload", hasFile: true,
        isCapturing: true, online: true, expected: .blocked(.capturing)),
    .init(
        name: "capturing without a file", state: "pending_upload", hasFile: false,
        isCapturing: true, online: false, expected: .blocked(.capturing)),
    .init(
        name: "uploading with a file", state: "pending_upload", hasFile: true,
        isCapturing: false, online: false, expected: .local(file)),
    .init(
        name: "failed with a file", state: "failed", hasFile: true,
        isCapturing: false, online: true, expected: .local(file)),
    .init(
        name: "processing with a file", state: "processing", hasFile: true,
        isCapturing: false, online: false, expected: .local(file)),
    .init(
        name: "ready with a file offline", state: "ready", hasFile: true,
        isCapturing: false, online: false, expected: .local(file)),
    .init(
        name: "ready without a file online", state: "ready", hasFile: false,
        isCapturing: false, online: true, expected: .fetch),
    .init(
        name: "ready without a file offline", state: "ready", hasFile: false,
        isCapturing: false, online: false, expected: .blocked(.offline)),
    .init(
        name: "processing without a file online", state: "processing", hasFile: false,
        isCapturing: false, online: true, expected: .blocked(.notReady)),
    .init(
        name: "uploading without a file", state: "pending_upload", hasFile: false,
        isCapturing: false, online: true, expected: .blocked(.notReady)),
]

@Test(arguments: readinessCases)
private func readinessFollowsTheTable(_ item: ReadinessCase) {
    let result = exportReadiness(
        state: item.state, localFile: item.hasFile ? file : nil, isCapturing: item.isCapturing, online: item.online)
    #expect(result == item.expected)
}
