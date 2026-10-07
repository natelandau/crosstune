import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct ResolvedCacheTests {
    private final class Counter {
        var made = 0
    }

    @Test func makesEachValueOnceWhileTheContextHolds() {
        let cache = ResolvedCache<String, Int, String>(limit: 8)
        let counter = Counter()
        let make = { (key: String) in
            cache.value(for: key, in: 1) {
                counter.made += 1
                return key.uppercased()
            }
        }
        #expect(make("a") == "A")
        #expect(make("a") == "A")
        #expect(make("b") == "B")
        #expect(counter.made == 2)
    }

    @Test func makesEveryValueAgainInANewContext() {
        let cache = ResolvedCache<String, Int, String>(limit: 8)
        _ = cache.value(for: "a", in: 1) { "light" }
        #expect(cache.value(for: "a", in: 2) { "dark" } == "dark")
        #expect(cache.value(for: "a", in: 2) { "unused" } == "dark")
    }

    @Test func emptiesRatherThanGrowPastItsLimit() {
        let cache = ResolvedCache<Int, Int, Int>(limit: 2)
        _ = cache.value(for: 1, in: 0) { 10 }
        _ = cache.value(for: 2, in: 0) { 20 }
        #expect(cache.value(for: 2, in: 0) { 0 } == 20)
        _ = cache.value(for: 3, in: 0) { 30 }
        #expect(cache.value(for: 1, in: 0) { 11 } == 11)
    }

    @Test func aNewColorSchemeIsANewTextEnvironment() {
        var light = EnvironmentValues()
        light.colorScheme = .light
        var dark = light
        dark.colorScheme = .dark
        #expect(TextEnvironment(light) == TextEnvironment(light))
        #expect(TextEnvironment(light) != TextEnvironment(dark))
    }
}
