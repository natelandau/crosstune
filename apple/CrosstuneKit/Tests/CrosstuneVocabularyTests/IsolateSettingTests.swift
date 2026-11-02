import Testing

@testable import CrosstuneVocabulary

@Test func standardIsolateSettingIsTheDefault() {
    let standard = IsolateSetting.standard
    #expect(standard.effect == .solo)
    #expect(standard.panStart == -100)
    #expect(standard.panEnd == 100)
    #expect(standard.lowHz == 40)
    #expect(standard.highHz == 16000)
    #expect(standard.isDefault)
}

@Test func mutedOrNarrowedIsolateSettingIsNotTheDefault() {
    var setting = IsolateSetting.standard
    setting.effect = .mute
    #expect(!setting.isDefault)
    for change in [
        { (s: inout IsolateSetting) in s.panStart = -50 },
        { (s: inout IsolateSetting) in s.panEnd = 0 },
        { (s: inout IsolateSetting) in s.lowHz = 200 },
        { (s: inout IsolateSetting) in s.highHz = 4000 },
    ] {
        var narrowed = IsolateSetting.standard
        change(&narrowed)
        #expect(!narrowed.isDefault)
    }
}

@Test func aMonoRecordingHearsItsIsolateSettingWithFullPan() {
    let narrowed = IsolateSetting(effect: .solo, panStart: -50, panEnd: 0, lowHz: 200, highHz: 16000)
    var fullPan = narrowed
    fullPan.panStart = -100
    fullPan.panEnd = 100
    #expect(narrowed.effective(isMono: true) == fullPan)
    #expect(narrowed.effective(isMono: false) == narrowed)
    let panOnly = IsolateSetting(effect: .solo, panStart: -100, panEnd: 0, lowHz: 40, highHz: 16000)
    #expect(panOnly.effective(isMono: true).isDefault)
}
