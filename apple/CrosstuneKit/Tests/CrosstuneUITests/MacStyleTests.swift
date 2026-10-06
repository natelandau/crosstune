#if os(macOS)
    import AppKit
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacStyleTests {
        @Test func sidebarTintTakesEachModesSlate() {
            let light = MacStyle.sidebarTint(.light).resolve(in: EnvironmentValues())
            let dark = MacStyle.sidebarTint(.dark).resolve(in: EnvironmentValues())
            #expect(light != dark)
            #expect(abs(Double(light.opacity) - 0.15) < 0.001)
            #expect(abs(Double(dark.opacity) - 0.20) < 0.001)
        }

        @Test func glassFallsBackToAnOpaqueFillBeforeAnyMaterial() {
            #expect(MacGlassMode(reduceTransparency: false, increasedContrast: false, drawsGlass: true) == .glass)
            #expect(MacGlassMode(reduceTransparency: false, increasedContrast: false, drawsGlass: false) == .material)
            for drawsGlass in [true, false] {
                #expect(
                    MacGlassMode(reduceTransparency: true, increasedContrast: false, drawsGlass: drawsGlass) == .opaque)
                #expect(
                    MacGlassMode(reduceTransparency: false, increasedContrast: true, drawsGlass: drawsGlass) == .opaque)
            }
        }
    }
#endif
