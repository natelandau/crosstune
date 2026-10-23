import SwiftUI

#if os(iOS)
    import UIKit
#elseif os(macOS)
    import IOKit.pwr_mgt
#endif

/// Keeps the display from sleeping while `content` is on screen and `active`, letting it sleep
/// again on dismiss and while the app is not active, since a screen backgrounded mid-reading is
/// not being read.
struct KeepsScreenAwake: ViewModifier {
    var active = true

    @Environment(\.scenePhase) private var scenePhase
    @State private var hold = ScreenAwakeHold()

    /// Whether the display stays awake for a view that is `active` in a scene at `phase`.
    static func holds(active: Bool, phase: ScenePhase) -> Bool {
        active && phase == .active
    }

    func body(content: Content) -> some View {
        content
            .onAppear { hold.set(Self.holds(active: active, phase: scenePhase)) }
            .onDisappear { hold.set(false) }
            .onChange(of: Self.holds(active: active, phase: scenePhase)) { _, holds in
                hold.set(holds)
            }
    }
}

/// The one claim on the display that a ``KeepsScreenAwake`` makes.
@MainActor
final class ScreenAwakeHold {
    private let holds: ScreenAwakeHolds
    /// SwiftUI makes and drops a hold on each pass of the view, so only one that has claimed the
    /// display lets go of it as it goes.
    private var holding = false

    init(holds: ScreenAwakeHolds = .shared) {
        self.holds = holds
    }

    func set(_ awake: Bool) {
        guard awake != holding else { return }
        holding = awake
        if awake { holds.claim() } else { holds.release() }
    }

    isolated deinit {
        if holding { holds.release() }
    }
}

/// Every hold on the display in the app, counted, since the system keeps one switch for the
/// whole app: one view letting go must not let the display sleep under another still reading.
@MainActor
final class ScreenAwakeHolds {
    static let shared = ScreenAwakeHolds(keepAwake: SystemDisplay().keepAwake)

    private(set) var count = 0
    private let keepAwake: @MainActor (Bool) -> Void

    init(keepAwake: @escaping @MainActor (Bool) -> Void) {
        self.keepAwake = keepAwake
    }

    func claim() {
        count += 1
        if count == 1 { keepAwake(true) }
    }

    func release() {
        guard count > 0 else { return }
        count -= 1
        if count == 0 { keepAwake(false) }
    }
}

/// iOS turns off the idle timer; the Mac holds a display-sleep assertion.
@MainActor
private final class SystemDisplay {
    #if os(macOS)
        private var assertion: IOPMAssertionID?
    #endif

    func keepAwake(_ awake: Bool) {
        #if os(iOS)
            UIApplication.shared.isIdleTimerDisabled = awake
        #elseif os(macOS)
            if awake, assertion == nil {
                var id = IOPMAssertionID(0)
                let made = IOPMAssertionCreateWithName(
                    kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
                    IOPMAssertionLevel(kIOPMAssertionLevelOn), "Crosstune is showing a reading screen" as CFString,
                    &id)
                if made == kIOReturnSuccess { assertion = id }
            } else if !awake, let id = assertion {
                IOPMAssertionRelease(id)
                assertion = nil
            }
        #endif
    }
}
