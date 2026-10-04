import CrosstuneCommands
import SwiftUI
import UniformTypeIdentifiers

#if os(iOS)
    import PhotosUI
    import VisionKit
#endif

/// A way to add notation pages.
public enum NotationAddChoice: String, Hashable, Sendable, Identifiable {
    case scan
    case photo
    case file

    public static let scanLabel = "Scan"
    public static let photoLabel = "Choose Photo"
    public static let fileLabel = "Choose File"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .scan: Self.scanLabel
        case .photo: Self.photoLabel
        case .file: Self.fileLabel
        }
    }

    public var systemImage: String {
        switch self {
        case .scan: "doc.viewfinder"
        case .photo: "photo.on.rectangle"
        case .file: "folder"
        }
    }

    /// The choices a device offers: Scan only where the document camera runs, which leaves out
    /// the simulator; Choose Photo only with a photo library; Choose File everywhere.
    static func available(scanSupported: Bool, photoLibrary: Bool) -> [NotationAddChoice] {
        (scanSupported ? [.scan] : []) + (photoLibrary ? [.photo] : []) + [.file]
    }

    /// The choices this device offers. The Mac has neither the document camera nor the photo
    /// picker, so it offers Choose File alone.
    @MainActor static var onThisDevice: [NotationAddChoice] {
        #if os(iOS)
            available(scanSupported: VNDocumentCameraViewController.isSupported, photoLibrary: true)
        #else
            available(scanSupported: false, photoLibrary: false)
        #endif
    }
}

/// The Notation header's add control: a menu of the ways this device adds pages, or a plain
/// button where there is only one.
struct NotationAddMenu: View {
    let isEnabled: Bool
    @Binding var choice: NotationAddChoice?

    var body: some View {
        let choices = NotationAddChoice.onThisDevice
        Group {
            if choices.count == 1, let only = choices.first {
                Button(NotationCopy.addNotation, systemImage: "plus") { choice = only }
            } else {
                Menu {
                    ForEach(choices) { option in
                        Button(option.label, systemImage: option.systemImage) { choice = option }
                    }
                } label: {
                    Label(NotationCopy.addNotation, systemImage: "plus")
                }
            }
        }
        .disabled(!isEnabled)
    }
}

/// Presents the picker or scanner the add menu chose and hands what it returns to `onPick`, each
/// image named for a message that says it could not be read.
struct NotationImport: ViewModifier {
    @Binding var choice: NotationAddChoice?
    let onPick: @MainActor ([NotationPick]) -> Void
    let onFailure: @MainActor (any Error) -> Void

    #if os(iOS)
        @State private var photos: [PhotosPickerItem] = []
    #endif

    func body(content: Content) -> some View {
        content
            .coversShell(choice == .file)
            .fileImporter(isPresented: shows(.file), allowedContentTypes: [.image], allowsMultipleSelection: true) {
                result in
                switch result {
                case .success(let urls): onPick(urls.map(NotationPick.file))
                case .failure(let error): onFailure(error)
                }
            }
            #if os(iOS)
                .coversShell(choice == .photo)
                .photosPicker(isPresented: shows(.photo), selection: $photos, maxSelectionCount: nil, matching: .images)
                .onChange(of: photos) { _, picked in
                    guard !picked.isEmpty else { return }
                    photos = []
                    onPick(
                        picked.enumerated().map { offset, item in
                            NotationPick.data(name: NotationImport.photoName(offset)) {
                                guard let data = try await item.loadTransferable(type: Data.self) else {
                                    throw PreparedPage.Error.undecodable
                                }
                                return data
                            }
                        })
                }
                .fullScreenCover(isPresented: shows(.scan)) {
                    ScanSheet(onFinish: { images in
                        onPick(
                            images.enumerated().map { offset, image in
                                let scanned = ScannedImage(image: image)
                                return NotationPick(name: NotationImport.scanName(offset)) {
                                    try PreparedPage.make(from: scanned.image)
                                }
                            })
                    })
                }
            #endif
    }

    /// A photo has no file name to quote, so it is named by its place in the pick.
    static func photoName(_ offset: Int) -> String { "Photo \(offset + 1)" }
    static func scanName(_ offset: Int) -> String { "Scanned page \(offset + 1)" }

    private func shows(_ option: NotationAddChoice) -> Binding<Bool> {
        Binding {
            choice == option
        } set: { shown in
            if !shown && choice == option { choice = nil }
        }
    }
}

#if os(iOS)
    /// A scanned page carried to the background task that prepares it. A `CGImage` is immutable
    /// once made, so handing it across is safe.
    private struct ScannedImage: @unchecked Sendable {
        let image: CGImage
    }
#endif
