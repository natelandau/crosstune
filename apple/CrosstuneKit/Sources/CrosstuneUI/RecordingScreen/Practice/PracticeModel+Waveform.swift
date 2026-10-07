import CrosstuneAudio
import CrosstuneStore
import Foundation

/// The waveform under its fixed center playhead: the zoom, scrubbing and its glide, taps, and
/// the playhead's moves.
extension PracticeModel {
    // MARK: Zoom

    var frame: ZoomFrame { ZoomFrame(width: width, lengthMs: Double(lengthMs)) }

    /// The scale that fits the whole trimmed recording.
    var minScale: Double { PracticeZoom.minPointsPerSecond(width: width, lengthMs: Double(lengthMs)) }

    /// The zoom held to what the view's width allows now, so turning the phone keeps the scale
    /// wherever it still fits; nil until the width and the length are known.
    var scale: Double? {
        guard width > 0, lengthMs > 0, let pointsPerSecond else { return nil }
        return min(max(pointsPerSecond, minScale), PracticeZoom.maxPointsPerSecond)
    }

    var canZoomIn: Bool { scale.map { $0 < PracticeZoom.maxPointsPerSecond } ?? false }
    var canZoomOut: Bool { scale.map { $0 > minScale } ?? false }

    func setWidth(_ width: Double) {
        guard width != self.width else { return }
        self.width = width
        ensureZoom()
    }

    /// Opens on the selected loop, or 30 seconds, once the view can be laid out.
    func ensureZoom() {
        guard pointsPerSecond == nil, width > 0, lengthMs > 0 else { return }
        pointsPerSecond = PracticeZoom.openingScale(
            loop: selected.map(Self.span), playheadMs: playheadMs, width: width)
    }

    /// Zooms by `factor` around the playhead, which is always the view's center.
    func zoom(by factor: Double) {
        guard let scale else { return }
        pointsPerSecond = PracticeZoom.zoomScale(scale, by: factor, frame: frame)
    }

    /// Zooms to `magnification` of the scale the pinch began at. A handle's drag the pinch's
    /// first finger began goes back unwritten, and a scrub leaves the playhead where it was.
    func pinch(_ magnification: Double) {
        if pinchBase == nil {
            pinchBase = scale
            pinches += 1
            cancelHandleDrag()
            if activeScrub != nil { scrubbingMs = nil }
        }
        guard let base = pinchBase else { return }
        pointsPerSecond = PracticeZoom.zoomScale(base, by: magnification, frame: frame)
    }

    func endPinch() {
        pinchBase = nil
    }

    /// Fit: frames the selected loop, bringing it under the playhead, or the whole recording
    /// when none is selected.
    func fit() {
        guard width > 0, lengthMs > 0 else { return }
        settleGlide()
        guard let row = selected, let span = shownSpan(row.id) else {
            pointsPerSecond = minScale
            return
        }
        pointsPerSecond = max(
            minScale, PracticeZoom.fitScale(span: span, playheadMs: playheadMs, width: width))
        if playheadMs < span.startMs || playheadMs >= span.endMs { seek(toMs: span.startMs - trimStartMs) }
    }

    // MARK: The playhead

    /// The playhead on the trimmed timeline, where a scrub has it while one is under way.
    var centerMs: Int64 { scrubbingMs ?? Int64(positionMs.rounded()) }

    /// Notes the player's position as it reports it.
    func noteElapsed(_ elapsed: TimeInterval) {
        reading = (elapsed, clock())
    }

    /// The playhead as drawn at `now`: while playing, run on from the player's last report at
    /// the playing speed, since the player reports only a few times a second. Never past the
    /// end, or the end of the loop repeating around it.
    func shownCenterMs(at now: ContinuousClock.Instant) -> Double {
        if let scrubbingMs { return Double(scrubbingMs) }
        let base = positionMs
        guard player.audio.isPlaying, let reading, abs(reading.elapsed * 1000 - base) < 1 else { return base }
        let parts = (now - reading.at).components
        let since = Double(parts.seconds) + Double(parts.attoseconds) / 1e18
        let ahead = min(max(0, since), AudioPlayer.tick) * Double(player.speedPercent) / 100 * 1000
        var limit = Double(lengthMs)
        if isRepeating, let row = selected, let span = shownSpan(row.id) {
            let end = Double(span.endMs - trimStartMs)
            if base < end { limit = min(limit, end) }
        }
        return min(base + ahead, max(base, limit))
    }

    /// The waveform as it shows now, centered on the playhead; nil until it can be laid out.
    var laneView: LaneView? {
        guard let scale else { return nil }
        return PracticeZoom.view(
            pointsPerSecond: scale, centerMs: Int64(shownCenterMs(at: clock()).rounded()), width: width,
            trimStartMs: trimStartMs)
    }

    /// What VoiceOver reads for the waveform: "0:42 of 3:10".
    var positionText: String { PracticeText.position(centerMs, of: lengthMs) }

    /// Moves the playhead to `ms` on the trimmed timeline, held within the recording. A scrub
    /// or glide under way settles there instead, so it cannot carry the playhead off again.
    func seek(toMs ms: Int64) {
        saveOpenRename()
        let held = min(max(ms, 0), lengthMs)
        if activeScrub != nil {
            settleScrub(at: held)
        } else {
            player.audio.seek(to: Double(held) / 1000)
        }
    }

    /// Moves the playhead by `deltaMs`, as the arrows and VoiceOver's swipes do.
    func seek(byMs deltaMs: Int64) {
        seek(toMs: centerMs + deltaMs)
    }

    /// Moves the playhead just far enough to bring `sourceMs` into view.
    func reveal(_ sourceMs: Int64) {
        guard let scale else { return }
        let ms = Double(sourceMs - trimStartMs)
        let center = shownCenterMs(at: clock())
        let reach = max(0, width / 2 - Self.autoPanZone) / scale * 1000
        if ms < center - reach {
            seek(toMs: Int64((ms + reach).rounded()))
        } else if ms > center + reach {
            seek(toMs: Int64((ms - reach).rounded()))
        }
    }

    // MARK: Scrubbing

    /// A drag on the waveform passed the threshold: playback holds where it is, and the audio
    /// scrolls under the playhead from there. A drag that catches a glide takes over from where
    /// the glide had got to.
    func beginScrub() {
        saveOpenRename()
        guard scale != nil else { return }
        if glide != nil, var caught = activeScrub {
            caught.originMs = scrubbingMs ?? caught.originMs
            glide?.cancel()
            glide = nil
            gliding = nil
            draggedMs = caught.originMs
            caught.pinch = pinches
            activeScrub = caught
            return
        }
        let playing = player.audio.isPlaying
        if playing { player.audio.pause() }
        let origin = Int64(positionMs.rounded())
        activeScrub = Scrub(originMs: origin, pinch: pinches, wasPlaying: playing)
        scrubbingMs = origin
    }

    /// The drag under way has moved `dx` points since it began.
    func scrub(dx: Double) {
        guard let scrub = activeScrub, let scale else { return }
        guard scrub.pinch == pinches else {
            scrubbingMs = nil
            return
        }
        scrubbingMs = PracticeZoom.scrub(from: scrub.originMs, dx: dx, pointsPerSecond: scale, lengthMs: lengthMs)
    }

    /// The drag is let go, headed for `predictedDx` points from where it began: it glides
    /// there, then playback seeks once and plays on if it was playing. A drag a pinch took over
    /// leaves the playhead where it was.
    func endScrub(predictedDx: Double) {
        guard let scrub = activeScrub, glide == nil else { return }
        guard scrub.pinch == pinches, let scale else {
            settleScrub(at: nil)
            return
        }
        let from = scrubbingMs ?? scrub.originMs
        let to = PracticeZoom.scrub(
            from: scrub.originMs, dx: predictedDx, pointsPerSecond: scale, lengthMs: lengthMs)
        if to == from || glideRun <= .zero {
            settleScrub(at: to)
        } else {
            glide(from: from, to: to)
        }
    }

    /// A glide under way stops where it has got to, so a command acts where the playhead shows
    /// and the glide cannot carry it off afterward.
    func settleGlide() {
        if glide != nil { settleScrub(at: scrubbingMs) }
    }

    /// A drag the system took away lands where it was dragged.
    func cancelScrub() {
        guard activeScrub != nil, glide == nil else { return }
        settleScrub(at: scrubbingMs)
    }

    /// Lets go of playback: seeks to `ms` unless nil, and plays on if it was playing, unless
    /// the playhead is at the end.
    func settleScrub(at ms: Int64?) {
        glide?.cancel()
        glide = nil
        gliding = nil
        let held = activeScrub
        activeScrub = nil
        if let ms { player.audio.seek(to: Double(min(max(ms, 0), lengthMs)) / 1000) }
        draggedMs = nil
        if held?.wasPlaying == true, (ms ?? 0) < lengthMs { player.audio.play() }
    }

    /// Coasts from `from` to `to` on ``PracticeZoom/glidePosition(from:to:elapsedMs:runMs:)``,
    /// then settles there.
    private func glide(from: Int64, to: Int64) {
        let run = glideRun
        let parts = run.components
        let runMs = Double(parts.seconds) * 1000 + Double(parts.attoseconds) / 1e15
        gliding = Glide(from: from, to: to, start: clock(), runMs: runMs)
        glide = Task { [weak self] in
            try? await Task.sleep(for: run)
            guard !Task.isCancelled else { return }
            self?.settleScrub(at: to)
        }
    }

    // MARK: Taps

    /// A tap `x` points from the waveform's left edge: selects the loop under it, or with none
    /// there deselects. A tap never seeks; one that lands during a glide stops it there.
    func tap(atX x: Double) {
        saveOpenRename()
        if glide != nil {
            settleGlide()
            return
        }
        guard let view = laneView else { return }
        let ms = Int64(view.sourceMs(atX: x).rounded())
        guard let hit = LoopModel.loop(at: ms, in: placedLoops) else {
            if selectedID != nil { select(nil) }
            return
        }
        guard hit.id != selectedID else { return }
        select(hit.id)
        if let row = row(hit.id) { announce(PracticeText.loopSelected(name(row))) }
    }
}
