import Testing

@testable import CrosstuneSync

@Test func namesADownloadFromTheIDAndRevision() throws {
    #expect(try downloadedFileName("0199a1b2-c3d4", rev: "p_1", contentType: "audio/mpeg") == "0199a1b2-c3d4-p_1.mp3")
    #expect(try peaksFileName("r1", rev: "p1") == "r1-p1.peaks")
    #expect(try downloadedScanName("s1") == "s1.jpg")
}

@Test(arguments: ["", "..", "../x", "a/b", "a.b", "a b", "\u{0663}"])
func refusesAServerValueThatIsNotAPlainNamePart(_ value: String) {
    #expect(throws: UnsafeFileNamePart.self) { try downloadedFileName(value, rev: "p1", contentType: nil) }
    #expect(throws: UnsafeFileNamePart.self) { try peaksFileName("r1", rev: value) }
    #expect(throws: UnsafeFileNamePart.self) { try downloadedScanName(value) }
}
