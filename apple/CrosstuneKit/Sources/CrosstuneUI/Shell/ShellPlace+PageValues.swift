import SwiftUI

extension ShellPlace {
    /// A page path's tune as the screens see it, by ``PagePath/listedTune``: the detail column's
    /// on the Mac, with no destination, or an iPad tab's.
    func listedTuneValue(in destination: Destination? = nil) -> ShellValue<String?> {
        ShellValue {
            self.pagePath(in: destination).listedTune
        } set: { tuneID in
            self.changePagePath(in: destination) { $0.setListedTune(tuneID) }
        }
    }

    /// The recording page a page path shows, as the recordings list reads and opens it: the
    /// detail column's on the Mac, with no destination, or an iPad tab's.
    func recordingValue(in destination: Destination? = nil) -> ShellValue<String?> {
        ShellValue {
            self.pagePath(in: destination).recording
        } set: { recordingID in
            self.changePagePath(in: destination) { $0.recording = recordingID }
        }
    }

    private func pagePath(in destination: Destination?) -> PagePath {
        guard let destination else { return detailPath }
        return tabPaths[destination] ?? PagePath()
    }

    private func changePagePath(in destination: Destination?, _ change: (inout PagePath) -> Void) {
        if let destination {
            change(&tabPaths[destination, default: PagePath()])
        } else {
            change(&detailPath)
        }
    }
}
