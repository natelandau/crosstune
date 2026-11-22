import CrosstuneShare
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import os

/// The share extension's entry point. Reads what was shared and hands it to the sheet.
final class ShareViewController: UIViewController {
    nonisolated private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "share-extension")

    // Without the App Group, an empty folder reads as signed out, so the sheet says to sign in
    // rather than failing.
    private let container =
        ShareContainer.appGroup() ?? ShareContainer(root: FileManager.default.temporaryDirectory)
    private lazy var model = ShareSheetModel(container: container)
    /// The save in progress, cancelled when the sheet is cancelled.
    private var saving: Task<Void, Never>?

    override func viewDidLoad() {
        super.viewDidLoad()
        let sheet = ShareView(
            model: model,
            perform: { [weak self] work in
                guard let self else { return }
                Task { await self.whileSaving(work) }
            },
            cancel: { [weak self] in
                self?.saving?.cancel()
                self?.extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
            },
            close: { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: nil)
            })
        let host = UIHostingController(rootView: sheet)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
        Task { await receive() }
    }

    private func receive() async {
        guard model.state != .signedOut else { return }
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let audio = items.flatMap { $0.attachments ?? [] }.compactMap { provider in
            Self.audioTypeID(of: provider).map { (provider, $0) }
        }
        if !audio.isEmpty {
            guard model.receivingAudio(count: audio.count) else { return }
            await whileSaving { await self.receiveAudio(audio) }
            return
        }
        for item in items {
            for provider in item.attachments ?? []
            where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                let url = await withCheckedContinuation { continuation in
                    Self.loadURL(from: provider) { continuation.resume(returning: $0) }
                }
                guard let url else { continue }
                let title = item.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines)
                if model.received(url: url.absoluteString, title: title?.isEmpty == false ? title : nil) {
                    await model.loadTunes()
                    return
                }
            }
        }
        model.state = .nothingToShare
    }

    private func receiveAudio(_ audio: [(NSItemProvider, String)]) async {
        guard let userID = model.userID,
            let folder = try? ShareInbox.newIncomingFolder(userID: userID, in: container)
        else {
            await model.received(audioFiles: [], unread: audio.count)
            return
        }
        defer { try? FileManager.default.removeItem(at: folder) }
        var files: [IncomingFile] = []
        var unread = 0
        for (index, (provider, typeID)) in audio.enumerated() {
            if Task.isCancelled { break }
            // A folder each, so two files with one name never overwrite each other.
            let destination = folder.appending(path: "\(index)", directoryHint: .isDirectory)
            let file = await withCheckedContinuation { continuation in
                Self.copyFile(from: provider, typeID: typeID, into: destination) { continuation.resume(returning: $0) }
            }
            if let file { files.append(file) } else { unread += 1 }
        }
        // Called even once cancelled, so each copied file is removed.
        await model.received(audioFiles: files, unread: unread)
    }

    /// Runs `work` while the system keeps the extension awake, so a save the sheet's closing
    /// would interrupt still finishes.
    private func whileSaving(_ work: @escaping @MainActor () async -> Void) async {
        let task = Task { @MainActor in await work() }
        saving = task
        ProcessInfo.processInfo.performExpiringActivity(withReason: "Saving shared items") { expired in
            guard !expired else {
                // The process is about to be suspended. A cancelled save removes the files it has
                // not saved, rather than leaving them half done.
                task.cancel()
                return
            }
            // The wait blocks the activity's own dispatch thread. It must never run on a Swift
            // concurrency thread: blocking one can starve the pool that runs `task` and hang here.
            let finished = DispatchSemaphore(value: 0)
            Task {
                await task.value
                finished.signal()
            }
            finished.wait()
        }
        await task.value
    }

    /// The type to load an audio attachment as, or nil when it holds no audio.
    private static func audioTypeID(of provider: NSItemProvider) -> String? {
        provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .audio) == true }
    }

    /// Nonisolated, so the system calls `done` on its own queue rather than trapping on a main
    /// actor check.
    nonisolated private static func loadURL(
        from provider: NSItemProvider, done: @escaping @Sendable (URL?) -> Void
    ) {
        _ = provider.loadObject(ofClass: URL.self) { url, error in
            if let error { logger.error("A shared link was not read: \(error)") }
            done(url)
        }
    }

    /// Copies the attachment into `folder`, keeping its file name, which names the recording.
    /// A name that gives no audio type takes the declared type's extension.
    nonisolated private static func copyFile(
        from provider: NSItemProvider, typeID: String, into folder: URL,
        done: @escaping @Sendable (IncomingFile?) -> Void
    ) {
        _ = provider.loadFileRepresentation(forTypeIdentifier: typeID) { file, error in
            // The system deletes `file` once this returns, so the copy happens here.
            guard let file else {
                logger.error("A shared audio file was not read: \(String(describing: error))")
                done(nil)
                return
            }
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let name = AudioFileCheck.fileName(file.lastPathComponent, declaredType: UTType(typeID))
                let destination = folder.appending(path: name.stored)
                try FileManager.default.copyItem(at: file, to: destination)
                let values = try destination.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey])
                // The app judges the file by its name's type, as an upload from Files is judged.
                done(
                    IncomingFile(
                        url: destination, type: values.contentType, bytes: Int64(values.fileSize ?? 0),
                        sharedName: file.lastPathComponent, label: name.label))
            } catch {
                logger.error("A shared audio file was not copied: \(error)")
                done(nil)
            }
        }
    }
}
