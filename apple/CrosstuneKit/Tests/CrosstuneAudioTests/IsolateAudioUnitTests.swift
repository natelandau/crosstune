import AVFoundation
import AudioToolbox
import Testing

@testable import CrosstuneAudio

@MainActor
struct IsolateAudioUnitTests {
    /// A sandboxed process, as every shipped app is, opens a component without this flag only
    /// after asking the user, and the node initializer raises when the answer is no.
    @Test func theRegisteredUnitIsSandboxSafe() throws {
        _ = try #require(IsolateAudioUnit.makeNode())
        var query = IsolateAudioUnit.componentDescription
        let component = try #require(AudioComponentFindNext(nil, &query))
        var registered = AudioComponentDescription()
        #expect(AudioComponentGetDescription(component, &registered) == noErr)
        #expect(registered.componentFlags & AudioComponentFlags.sandboxSafe.rawValue != 0)
    }

    @Test func aUnitTheSystemCannotMakeGivesNoNode() {
        let unknown = AudioComponentDescription(
            componentType: kAudioUnitType_Effect, componentSubType: 0x6E6F_6E65,  // "none"
            componentManufacturer: 0x4372_7374,  // "Crst"
            componentFlags: 0, componentFlagsMask: 0)
        #expect(IsolateAudioUnit.makeNode(for: unknown) == nil)
    }
}
