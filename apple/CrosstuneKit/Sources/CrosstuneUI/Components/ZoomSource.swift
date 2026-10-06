import SwiftUI

extension EnvironmentValues {
    /// Where a scan thumbnail marks itself for the viewer to zoom out of, or nil where the viewer
    /// opens without a zoom.
    @Entry var scanZoom: Namespace.ID?
    /// Where the lyrics row marks itself for the reader to zoom out of, or nil where the reader
    /// opens without a zoom.
    @Entry var lyricsZoom: Namespace.ID?
}

extension View {
    /// Marks this view as where a presentation with `id` zooms out of and back into, when there is
    /// a namespace to mark it in.
    @ViewBuilder
    func zoomSource(id: some Hashable, in namespace: Namespace.ID?) -> some View {
        if let namespace {
            matchedTransitionSource(id: id, in: namespace)
        } else {
            self
        }
    }

    #if os(iOS)
        /// Zooms this presentation out of the view marked with `id`, or presents it plainly when
        /// there is no namespace.
        @ViewBuilder
        func zooms(from id: (some Hashable)?, in namespace: Namespace.ID?) -> some View {
            if let id, let namespace {
                navigationTransition(.zoom(sourceID: id, in: namespace))
            } else {
                self
            }
        }
    #endif
}
