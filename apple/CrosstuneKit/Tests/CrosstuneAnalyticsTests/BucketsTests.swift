import Testing

@testable import CrosstuneAnalytics

@Test(arguments: [
    (0, "0"), (1, "1-9"), (9, "1-9"), (10, "10-49"), (49, "10-49"), (50, "50-199"), (199, "50-199"),
    (200, "200+"), (5_000, "200+"), (-1, "0"),
])
func bucketsACount(count: Int, bucket: String) {
    #expect(Bucket.count(count) == bucket)
}

@Test(arguments: [
    (0.0, "<30s"), (29.9, "<30s"), (30.0, "30s-2m"), (119.9, "30s-2m"), (120.0, "2-5m"), (299.9, "2-5m"),
    (300.0, "5m+"), (3_600.0, "5m+"),
])
func bucketsADuration(seconds: Double, bucket: String) {
    #expect(Bucket.duration(seconds: seconds) == bucket)
}

private let megabyte: Int64 = 1_000_000

private let byteBuckets: [(Int64, String)] = [
    (0, "0"), (1, "<10MB"), (10 * megabyte - 1, "<10MB"), (10 * megabyte, "10-50MB"), (50 * megabyte - 1, "10-50MB"),
    (50 * megabyte, "50-500MB"), (500 * megabyte - 1, "50-500MB"), (500 * megabyte, "500MB+"),
]

@Test(arguments: byteBuckets)
func bucketsAByteCount(bytes: Int64, bucket: String) {
    #expect(Bucket.bytes(bytes) == bucket)
}

@Test(arguments: [
    (0.5, "<0.75"), (0.74, "<0.75"), (0.75, "0.75-0.99"), (0.99, "0.75-0.99"), (0.9999, "1"), (1.0, "1"), (1.0001, "1"),
    (1.01, ">1"), (2.0, ">1"),
])
func bucketsASpeed(rate: Double, bucket: String) {
    #expect(Bucket.speed(rate) == bucket)
}

private let listenedBuckets: [(Int64, String)] = [
    (0, "<10s"), (9_999, "<10s"), (10_000, "10-30s"), (29_999, "10-30s"), (30_000, "30s-2m"), (119_999, "30s-2m"),
    (120_000, "2-5m"), (299_999, "2-5m"), (300_000, "5m+"),
]

@Test(arguments: listenedBuckets)
func bucketsTimeListened(ms: Int64, bucket: String) {
    #expect(Bucket.listened(ms: ms) == bucket)
}
