@preconcurrency import AVFoundation
import AudioToolbox
import CrosstuneVocabulary
import Foundation
import Synchronization

/// An effect that runs an ``IsolateMask`` on the audio passing through it. Bypassed, it passes
/// the input through untouched and runs no mask. Engaging feeds the mask while the output stays
/// dry until the mask's latency has passed, then crossfades over 50 ms; bypassing crossfades
/// back.
///
/// Call every method from one thread, never the render thread. The setting, a reset, and
/// whether the unit is engaged reach the render thread through atomic slots it reads at the
/// start of each block, and the outline comes back the same way, so the render block never
/// waits on a lock or allocates.
public final class IsolateAudioUnit: AUAudioUnit {
    /// The effect's identity, registered for this process only. Without the sandbox-safe flag, a
    /// sandboxed app opens the unit only after asking the user, and opening fails unanswered.
    static let componentDescription = AudioComponentDescription(
        componentType: kAudioUnitType_Effect,
        componentSubType: fourCharacterCode("isol"),
        componentManufacturer: fourCharacterCode("Crst"),
        componentFlags: AudioComponentFlags.sandboxSafe.rawValue,
        componentFlagsMask: 0)

    private static let registration: Void = AUAudioUnit.registerSubclass(
        IsolateAudioUnit.self, as: componentDescription, name: "Crosstune: Isolate", version: 1)

    /// A node holding a new isolate unit, ready to attach to an engine, or nil when the system
    /// cannot open the unit or made some other unit for the description. The initializer
    /// creates the registered subclass in this process before it returns, on macOS and iOS
    /// alike, unlike `instantiate`, which may answer later.
    static func makeNode() -> (node: AVAudioUnitEffect, unit: IsolateAudioUnit)? {
        _ = registration
        return makeNode(for: componentDescription)
    }

    /// A node for the unit `description` names, or nil when the system cannot open it.
    static func makeNode(for description: AudioComponentDescription) -> (
        node: AVAudioUnitEffect, unit: IsolateAudioUnit
    )? {
        // The node initializer raises an Objective-C exception, which Swift cannot catch, when
        // the system cannot open the unit, so opening it first turns that into nil.
        guard canInstantiate(description) else { return nil }
        let node = AVAudioUnitEffect(audioComponentDescription: description)
        guard let unit = node.auAudioUnit as? IsolateAudioUnit else { return nil }
        return (node, unit)
    }

    /// What the mask keeps.
    public private(set) var setting = IsolateSetting.standard
    /// Whether the audio is mono, so the mask ignores pan.
    public private(set) var isMono = false
    /// Whether something on screen shows the outline, such as the Isolate panel.
    private var isOutlineWanted = false
    /// Whether the mask runs: its outline wanted, or a setting that changes the sound.
    public var isEngaged: Bool { isOutlineWanted || !setting.effective(isMono: isMono).isDefault }

    private let kernel = IsolateKernel()
    private var inputBusArray: AUAudioUnitBusArray!
    private var outputBusArray: AUAudioUnitBusArray!

    public override init(
        componentDescription: AudioComponentDescription, options: AudioComponentInstantiationOptions = []
    ) throws {
        try super.init(componentDescription: componentDescription, options: options)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2)!
        inputBusArray = AUAudioUnitBusArray(
            audioUnit: self, busType: .input, busses: [try AUAudioUnitBus(format: format)])
        outputBusArray = AUAudioUnitBusArray(
            audioUnit: self, busType: .output, busses: [try AUAudioUnitBus(format: format)])
        kernel.publish(setting, isMono: isMono)
    }

    public override var inputBusses: AUAudioUnitBusArray { inputBusArray }
    public override var outputBusses: AUAudioUnitBusArray { outputBusArray }
    public override var canProcessInPlace: Bool { true }

    public override func allocateRenderResources() throws {
        // iOS asks for 4096 frames a block while the screen is locked.
        if maximumFramesToRender < 4096 { maximumFramesToRender = 4096 }
        try super.allocateRenderResources()
        let input = inputBusArray[0].format
        let output = outputBusArray[0].format
        guard input.channelCount == output.channelCount, input.sampleRate == output.sampleRate,
            input.commonFormat == .pcmFormatFloat32, !input.isInterleaved
        else {
            super.deallocateRenderResources()
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(kAudioUnitErr_FormatNotSupported))
        }
        kernel.allocate(
            channels: Int(input.channelCount), sampleRate: input.sampleRate, maxFrames: Int(maximumFramesToRender),
            setting: setting, isMono: isMono)
    }

    public override func deallocateRenderResources() {
        kernel.deallocate()
        super.deallocateRenderResources()
    }

    /// Drops the mask's buffered audio at the start of the next block, for a seek.
    public override func reset() {
        super.reset()
        kernel.requestReset()
    }

    public override var internalRenderBlock: AUInternalRenderBlock {
        let kernel = kernel
        return { _, timestamp, frameCount, _, outputData, _, pullInputBlock in
            kernel.render(timestamp: timestamp, frameCount: frameCount, output: outputData, pull: pullInputBlock)
        }
    }

    /// Keeps what `s` describes; `isMono` makes the mask ignore pan. Engages the unit unless `s`
    /// is the default and nothing wants the outline.
    public func setIsolate(_ s: IsolateSetting, isMono: Bool) {
        setting = s
        self.isMono = isMono
        kernel.publish(s, isMono: isMono)
        kernel.setEngaged(isEngaged)
    }

    /// Asks for the outline, as the Isolate panel does while it shows, or lets it go. Wanted, the
    /// outline engages the unit at any setting.
    public func setOutlineWanted(_ on: Bool) {
        isOutlineWanted = on
        kernel.setOutlineWanted(on)
        kernel.setEngaged(isEngaged)
    }

    /// Input magnitude by pan and by frequency of the mask's last frame, nil while not wanted.
    public var outline: IsolateOutline? {
        isOutlineWanted ? kernel.readOutline() : nil
    }
}

private func canInstantiate(_ description: AudioComponentDescription) -> Bool {
    var query = description
    guard let component = AudioComponentFindNext(nil, &query) else { return false }
    var instance: AudioComponentInstance?
    guard AudioComponentInstanceNew(component, &instance) == noErr, let instance else { return false }
    AudioComponentInstanceDispose(instance)
    return true
}

private func fourCharacterCode(_ code: String) -> FourCharCode {
    code.utf8.reduce(0) { $0 << 8 | FourCharCode($1) }
}

/// Slot indices of a triple buffer: one writer and one reader each own a slot, and the third
/// passes between them, so neither waits for the other or sees a slot half written.
final class TripleBufferIndex: @unchecked Sendable {
    private static let fresh = 4
    /// The slot between writer and reader, with ``fresh`` set when the writer has filled it since
    /// the reader last took it.
    private let shared = Atomic<Int>(1)
    /// The writer's slot; only the writer touches it.
    private(set) var writeSlot = 0
    /// The reader's slot; only the reader touches it.
    private(set) var readSlot = 2

    /// Hands the filled write slot to the reader and takes another to fill.
    func publish() {
        writeSlot = shared.exchange(writeSlot | Self.fresh, ordering: .acquiringAndReleasing) & 3
    }

    /// Takes the newest filled slot as the read slot. False when nothing new was published.
    @discardableResult
    func acquire() -> Bool {
        guard shared.load(ordering: .relaxed) & Self.fresh != 0 else { return false }
        readSlot = shared.exchange(readSlot, ordering: .acquiringAndReleasing) & 3
        return true
    }
}

/// The isolate unit's render-thread state. Methods named for the render thread run only there;
/// every other method runs on one other thread.
final class IsolateKernel: @unchecked Sendable {
    private static let crossfadeSeconds = 0.05

    private let mask = IsolateMask(sampleRate: 44_100)

    // Settings, written off the render thread and read on it.
    private let settingIndex = TripleBufferIndex()
    private let settings = UnsafeMutablePointer<IsolateSetting>.allocate(capacity: 3)
    private let monos = UnsafeMutablePointer<Bool>.allocate(capacity: 3)
    private let weights = UnsafeMutablePointer<Float>.allocate(capacity: 3 * IsolateMask.binCount)
    /// The sample rate the published weights were worked out for.
    private var publishedSampleRate = 44_100.0

    // Outline, written on the render thread and read off it.
    private static let outlineStride = outlinePanBins + outlineFreqBins
    private let outlineIndex = TripleBufferIndex()
    private let outlines = UnsafeMutablePointer<Float>.allocate(capacity: 3 * outlineStride)

    private let engaged = Atomic<Bool>(false)
    private let outlineWanted = Atomic<Bool>(false)
    /// Set when the outline becomes wanted, until the render thread publishes one of the audio
    /// since.
    private let outlineStale = Atomic<Bool>(false)
    private let resetRequested = Atomic<Bool>(false)

    // Render resources, made in `allocate` while the render thread is stopped.
    private var channels = 0
    private var maxFrames = 0
    private var inputSamples: UnsafeMutablePointer<Float>?
    private var latencyFrames = 0
    private var wetLeft: UnsafeMutablePointer<Float>?
    private var wetRight: UnsafeMutablePointer<Float>?
    /// Each frame's crossfade gains, shared by every channel.
    private var dryGains: UnsafeMutablePointer<Float>?
    private var wetGains: UnsafeMutablePointer<Float>?
    private var inputList: UnsafeMutableAudioBufferListPointer?
    private var crossfadeStep: Float = 1

    // Render thread only.
    /// How much of the output is the mask's, 0 to 1.
    private var wetMix: Float = 0
    /// Frames fed to the mask since engaging from bypass. The output stays dry until they pass
    /// its latency, so the crossfade never fades toward silence.
    private var primedFrames = 0

    init() {
        settings.initialize(repeating: .standard, count: 3)
        monos.initialize(repeating: false, count: 3)
        weights.initialize(repeating: 1, count: 3 * IsolateMask.binCount)
        outlines.initialize(repeating: 0, count: 3 * Self.outlineStride)
    }

    deinit {
        deallocate()
        settings.deinitialize(count: 3)
        settings.deallocate()
        monos.deallocate()
        weights.deallocate()
        outlines.deallocate()
    }

    // MARK: Off the render thread

    func publish(_ s: IsolateSetting, isMono: Bool) {
        let slot = settingIndex.writeSlot
        settings[slot] = s
        monos[slot] = isMono
        IsolateMask.frequencyWeights(
            for: s, sampleRate: publishedSampleRate, into: weights + slot * IsolateMask.binCount)
        settingIndex.publish()
    }

    func setEngaged(_ on: Bool) {
        engaged.store(on, ordering: .relaxed)
    }

    func setOutlineWanted(_ on: Bool) {
        // The last outline published was of earlier audio, not the audio playing now.
        if on && !outlineWanted.load(ordering: .relaxed) { outlineStale.store(true, ordering: .relaxed) }
        outlineWanted.store(on, ordering: .relaxed)
    }

    func requestReset() {
        resetRequested.store(true, ordering: .releasing)
    }

    /// The outline the render thread published last, nil until it publishes one after the
    /// outline becomes wanted.
    func readOutline() -> IsolateOutline? {
        guard !outlineStale.load(ordering: .acquiring) else { return nil }
        outlineIndex.acquire()
        let pan = outlines + outlineIndex.readSlot * Self.outlineStride
        return IsolateOutline(panSums: pan, freqSums: pan + outlinePanBins)
    }

    /// Makes the render buffers. The engine calls it with the render thread stopped, so the mask
    /// is set here directly.
    func allocate(channels: Int, sampleRate: Double, maxFrames: Int, setting: IsolateSetting, isMono: Bool) {
        deallocate()
        self.channels = channels
        self.maxFrames = maxFrames
        inputSamples = .allocate(capacity: channels * maxFrames)
        wetLeft = .allocate(capacity: maxFrames)
        wetRight = .allocate(capacity: maxFrames)
        dryGains = .allocate(capacity: maxFrames)
        wetGains = .allocate(capacity: maxFrames)
        let list = AudioBufferList.allocate(maximumBuffers: channels)
        for channel in 0..<channels {
            list[channel] = AudioBuffer(
                mNumberChannels: 1, mDataByteSize: 0,
                mData: inputSamples.map { UnsafeMutableRawPointer($0 + channel * maxFrames) })
        }
        inputList = list
        latencyFrames = mask.latencyFrames
        crossfadeStep = Float(1 / (Self.crossfadeSeconds * sampleRate))
        if sampleRate != publishedSampleRate {
            publishedSampleRate = sampleRate
            mask.setSampleRate(sampleRate)
        }
        // Republished so the render thread never applies weights worked out for an older rate.
        publish(setting, isMono: isMono)
        mask.setSetting(setting, isMono: isMono)
        mask.reset()
        resetRequested.store(false, ordering: .relaxed)
        // Playback starts from silence, so an engaged unit needs no priming.
        wetMix = engaged.load(ordering: .relaxed) ? 1 : 0
        primedFrames = 0
    }

    func deallocate() {
        inputSamples?.deallocate()
        wetLeft?.deallocate()
        wetRight?.deallocate()
        dryGains?.deallocate()
        wetGains?.deallocate()
        inputList?.unsafeMutablePointer.deallocate()
        inputSamples = nil
        wetLeft = nil
        wetRight = nil
        dryGains = nil
        wetGains = nil
        inputList = nil
        channels = 0
        maxFrames = 0
    }

    // MARK: Render thread

    func render(
        timestamp: UnsafePointer<AudioTimeStamp>, frameCount: AUAudioFrameCount,
        output: UnsafeMutablePointer<AudioBufferList>, pull: AURenderPullInputBlock?
    ) -> AUAudioUnitStatus {
        guard let pull, let inputList, let inputSamples, let wetLeft, let wetRight, let dryGains, let wetGains else {
            return kAudioUnitErr_NoConnection
        }
        let frames = Int(frameCount)
        guard frames <= maxFrames else { return kAudioUnitErr_TooManyFramesToProcess }

        let byteSize = UInt32(frames * MemoryLayout<Float>.size)
        // Upstream may point the list at its own memory, so each pull starts from the unit's.
        for channel in 0..<channels {
            inputList[channel].mData = UnsafeMutableRawPointer(inputSamples + channel * maxFrames)
            inputList[channel].mDataByteSize = byteSize
        }
        var flags = AudioUnitRenderActionFlags()
        let status = pull(&flags, timestamp, frameCount, 0, inputList.unsafeMutablePointer)
        guard status == noErr else { return status }

        let outputList = UnsafeMutableAudioBufferListPointer(output)
        let outputChannels = min(outputList.count, channels)
        for channel in 0..<outputChannels {
            // A nil buffer asks the unit to render into its own memory.
            if outputList[channel].mData == nil { outputList[channel].mData = inputList[channel].mData }
            outputList[channel].mDataByteSize = byteSize
        }

        if settingIndex.acquire() {
            let slot = settingIndex.readSlot
            mask.apply(settings[slot], isMono: monos[slot], frequencyWeights: weights + slot * IsolateMask.binCount)
        }
        let target: Float = engaged.load(ordering: .relaxed) ? 1 : 0
        let wantsOutline = outlineWanted.load(ordering: .relaxed)
        mask.measuresOutline = wantsOutline
        let resetAsked = resetRequested.exchange(false, ordering: .acquiring)

        // Mid-fade, the cleared mask would leave the fade between dry and silence, so a reset
        // drops to dry: bypassing ends there, and engaging primes again.
        if resetAsked && wetMix > 0 && wetMix < 1 {
            wetMix = 0
            primedFrames = 0
        }
        if wetMix == 0 && target == 0 {
            primedFrames = 0
            for channel in 0..<outputChannels { copy(inputList[channel], to: outputList[channel], frames: frames) }
            return noErr
        }
        let engaging = wetMix == 0 && primedFrames == 0
        if engaging || resetAsked {
            mask.reset()
            if wetMix == 0 { primedFrames = 0 }
        }

        let left = sample(inputList[0])
        let right = channels > 1 ? sample(inputList[1]) : left
        wetLeft.update(from: left, count: frames)
        wetRight.update(from: right, count: frames)
        mask.process(left: wetLeft, right: wetRight, frames: frames)
        if wantsOutline { publishOutline() }

        if wetMix == 0 {
            let fed = primedFrames
            primedFrames += frames
            if fed < latencyFrames {
                for channel in 0..<outputChannels { copy(inputList[channel], to: outputList[channel], frames: frames) }
                return noErr
            }
        }

        let fading = wetMix != target
        if fading && outputChannels > 0 {
            var mix = wetMix
            for i in 0..<frames {
                mix = target > mix ? min(target, mix + crossfadeStep) : max(target, mix - crossfadeStep)
                // Equal power, since the wet path lags the dry by the mask's latency and the two
                // add as unrelated signals rather than in phase.
                let angle = mix * .pi / 2
                dryGains[i] = cos(angle)
                wetGains[i] = sin(angle)
            }
            wetMix = mix
        }
        for channel in 0..<outputChannels {
            let dry = sample(inputList[channel])
            let out = sample(outputList[channel])
            guard channel < 2 else {
                copy(inputList[channel], to: outputList[channel], frames: frames)
                continue
            }
            let wet = channel == 0 ? wetLeft : wetRight
            if !fading {
                if target == 1 {
                    out.update(from: wet, count: frames)
                } else if out != dry {
                    out.update(from: dry, count: frames)
                }
                continue
            }
            for i in 0..<frames { out[i] = dry[i] * dryGains[i] + wet[i] * wetGains[i] }
        }
        return noErr
    }

    private func publishOutline() {
        guard mask.outlineIsCurrent else { return }
        let pan = outlines + outlineIndex.writeSlot * Self.outlineStride
        mask.copyOutlineSums(pan: pan, freq: pan + outlinePanBins)
        outlineIndex.publish()
        outlineStale.store(false, ordering: .releasing)
    }
}

private func sample(_ buffer: AudioBuffer) -> UnsafeMutablePointer<Float> {
    buffer.mData!.assumingMemoryBound(to: Float.self)
}

private func copy(_ source: AudioBuffer, to destination: AudioBuffer, frames: Int) {
    guard source.mData != destination.mData else { return }
    sample(destination).update(from: sample(source), count: frames)
}
