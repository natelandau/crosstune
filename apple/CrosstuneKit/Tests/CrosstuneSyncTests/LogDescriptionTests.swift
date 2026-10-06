import Foundation
import Testing

@testable import CrosstuneSync

@Test func logDescriptionDropsAPresignedURLsSignature() {
    let url = URL(string: "https://storage.example.com/u/rec.m4a?X-Amz-Signature=secret&X-Amz-Expires=900")!
    let error = URLError(.timedOut, userInfo: [NSURLErrorFailingURLErrorKey: url])
    let text = logDescription(of: error)
    #expect(!text.contains("secret"))
    #expect(text.contains("https://storage.example.com/u/rec.m4a?…"))
}

@Test func logDescriptionKeepsAnErrorWithoutAURL() {
    struct Failure: Error {}
    #expect(logDescription(of: Failure()) == String(describing: Failure()))
}
