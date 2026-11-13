import AVFoundation
import Foundation
import Testing

@testable import CrosstuneExport

private func makeTempDirectory() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func writeTone(to url: URL, fileExtension: String = "m4a") throws {
    let sampleRate = 44_100.0
    let settings: [String: Any] =
        fileExtension == "m4a"
        ? [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 1,
        ]
        : [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
        ]
    let file = try AVAudioFile(forWriting: url, settings: settings)
    let format = file.processingFormat
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100)!
    buffer.frameLength = 44_100
    for i in 0..<Int(buffer.frameLength) {
        buffer.floatChannelData![0][i] = Float(sin(Double(i) * 2 * .pi * 440 / sampleRate)) * 0.3
    }
    try file.write(from: buffer)
}

private func locationItem() -> AVMutableMetadataItem {
    let item = AVMutableMetadataItem()
    item.identifier = .commonIdentifierLocation
    item.value = "+37.7749-122.4194/" as NSString
    item.dataType = kCMMetadataBaseDataType_UTF8 as String
    return item
}

// MP4 stores a location as the 3GPP `loci` atom, which AVFoundation reports as `uiso/loci`.
private func locationItems(in url: URL) async throws -> [AVMetadataItem] {
    let asset = AVURLAsset(url: url)
    var items = try await asset.load(.metadata)
    for format in try await asset.load(.availableMetadataFormats) {
        items += try await asset.loadMetadata(for: format)
    }
    return items.filter {
        $0.identifier == .quickTimeMetadataLocationISO6709 || $0.identifier == .commonIdentifierLocation
            || $0.identifier?.rawValue == "uiso/loci" || $0.commonKey == .commonKeyLocation
    }
}

@Suite struct AudioTagsTests {
    @Test func writesTitleAlbumAndDateAndNoLocation() async throws {
        let dir = try makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let source = dir.appending(path: "source.m4a")
        let destination = dir.appending(path: "out.m4a")
        let plain = dir.appending(path: "plain.m4a")
        try writeTone(to: plain)
        let located = AVAssetExportSession(asset: AVURLAsset(url: plain), presetName: AVAssetExportPresetPassthrough)!
        located.metadata = [locationItem()]
        try await located.export(to: source, as: .m4a)
        #expect(!(try await locationItems(in: source)).isEmpty)
        let before = try Data(contentsOf: source)

        try await AudioTags.write(
            from: source, to: destination,
            tags: AudioTagValues(title: "The Silver Spear", album: "Crosstune", date: "2026-11-12"))

        let metadata = try await AVURLAsset(url: destination).load(.metadata)
        func string(_ id: AVMetadataIdentifier) async throws -> String? {
            let items = AVMetadataItem.metadataItems(from: metadata, filteredByIdentifier: id)
            return try await items.first?.load(.stringValue)
        }
        #expect(try await string(.iTunesMetadataSongName) == "The Silver Spear")
        #expect(try await string(.iTunesMetadataAlbum) == "Crosstune")
        #expect(try await string(.iTunesMetadataReleaseDate) == "2026-11-12")
        #expect(try await locationItems(in: destination).isEmpty)
        #expect(try Data(contentsOf: source) == before)
    }

    @Test(arguments: ["wav", "m4a"])
    func throwsForASourceItCannotExportAndLeavesNoDestination(fileExtension: String) async throws {
        let dir = try makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let source = dir.appending(path: "source.\(fileExtension)")
        let destination = dir.appending(path: "out.m4a")
        if fileExtension == "wav" {
            try writeTone(to: source, fileExtension: fileExtension)
        } else {
            try Data(repeating: 7, count: 2_048).write(to: source)
        }

        await #expect(throws: (any Error).self) {
            try await AudioTags.write(
                from: source, to: destination, tags: AudioTagValues(title: "T", album: nil, date: nil))
        }
        #expect(!FileManager.default.fileExists(atPath: destination.path(percentEncoded: false)))
    }

    @Test func refusesAnExistingDestinationAndLeavesItAlone() async throws {
        let dir = try makeTempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let source = dir.appending(path: "source.m4a")
        let destination = dir.appending(path: "out.m4a")
        try writeTone(to: source)
        try Data("keep".utf8).write(to: destination)

        await #expect(throws: AudioTagsError.destinationExists) {
            try await AudioTags.write(
                from: source, to: destination, tags: AudioTagValues(title: "T", album: nil, date: nil))
        }
        #expect(try Data(contentsOf: destination) == Data("keep".utf8))
    }
}
