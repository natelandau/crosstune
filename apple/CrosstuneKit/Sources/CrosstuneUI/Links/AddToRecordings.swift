import CrosstuneStore

/// Whether a link row offers Add to recordings: the service's audio is one the server can fetch,
/// the link names a track on it, and no live recording of the tune already came from this page.
func canAddToRecordings(link: RecordingLink, recordings: [Recording]) -> Bool {
    FindRecordingsModel.importable.contains(link.provider) && link.providerRef != nil
        && !recordings.contains { $0.deletedAt == nil && $0.originURL == link.url }
}
