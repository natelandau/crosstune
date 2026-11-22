import CrosstuneShare
import Testing
import UniformTypeIdentifiers

struct AudioFileCheckTests {
    @Test(
        arguments: [
            (UTType.mpeg4Audio, 10, 100, nil),
            (.png, 10, 100, .notAudio),
            (nil, 10, 100, .notAudio),
            (.mpeg4Audio, 0, 100, .emptyFile),
            (.mpeg4Audio, 101, 100, .tooLarge(maxFileBytes: 100)),
            (UTType("com.apple.quicktime-audio"), 10, 100, nil),
            (.mpeg4Audio, 10, nil, nil),
        ] as [(UTType?, Int64, Int?, AudioFileCheck.Reason?)]
    )
    func refusesWhatTheServerRefuses(type: UTType?, bytes: Int64, maxFileBytes: Int?, expected: AudioFileCheck.Reason?)
    {
        #expect(AudioFileCheck.reason(type: type, bytes: bytes, maxFileBytes: maxFileBytes) == expected)
    }

    /// A name with no audio extension takes the sharing app's declared type, so the app's check,
    /// which reads the type from the name, agrees with it. The label is the name as shared.
    @Test(
        arguments: [
            ("Memo.m4a", UTType.mpeg4Audio, "Memo.m4a", "Memo"),
            ("Memo.qta", UTType("com.apple.quicktime-audio"), "Memo.qta", "Memo"),
            ("Memo", .mpeg4Audio, "Memo.m4a", "Memo"),
            ("Memo.dat", .mp3, "Memo.dat.mp3", "Memo"),
            ("Notes.txt", .plainText, "Notes.txt", "Notes"),
            ("Memo", nil, "Memo", "Memo"),
        ] as [(String, UTType?, String, String)]
    )
    func namesAFileForItsAudioType(name: String, declared: UTType?, stored: String, label: String) {
        let named = AudioFileCheck.fileName(name, declaredType: declared)
        #expect(named.stored == stored)
        #expect(named.label == label)
    }
}
