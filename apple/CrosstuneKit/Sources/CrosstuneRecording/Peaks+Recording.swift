import CrosstuneAudio
import CrosstuneStore
import Foundation

extension Peaks {
    /// Writes this waveform beside `recordingID`'s audio in `store`'s folder and returns its
    /// file name.
    public func write(for recordingID: String, in store: CrosstuneStore) throws -> String {
        let name = CaptureFiles.peaksName(recordingID)
        try encoded().write(to: store.audioFolder.appending(path: name), options: .atomic)
        return name
    }
}
