import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import Foundation
import Observation
import os

/// The paste link sheet's state: the pasted link, its label, the title the server finds for the link
/// as it is pasted, and the one save the sheet makes.
@MainActor
@Observable
public final class LinkSheetModel {
    /// Asks the server what a link points to; nil when offline or when the lookup fails.
    public typealias Resolve = @MainActor (_ url: String) async -> ResolvedLink?

    public static let linkRequired = "Paste a link to add it"
    public static let linkNotWeb = "Paste a web address, one that starts with http or https"

    /// The tune the link is added to.
    public let tuneID: String
    public private(set) var url = ""
    public private(set) var label = ""
    /// The title the server found for the link as pasted, shown before the save.
    public private(set) var preview: String?
    public private(set) var isSaving = false
    /// Set once a save lands; the sheet never saves twice, so a second press adds no second link.
    public private(set) var isSaved = false
    /// Shown under the link after a save with no link, or with one that is not a web address.
    public private(set) var validation: String?
    /// The last save's failure, cleared as the fields are retyped.
    public private(set) var failure: String?

    private let store: CrosstuneStore
    private let resolve: Resolve?
    private let debounce: Duration
    /// The link as last typed, while it is waiting to be looked up or has been.
    @ObservationIgnored private var lookupURL: String?
    @ObservationIgnored private var debounceTask: Task<Void, Never>?
    @ObservationIgnored private var lookup: Task<ResolvedLink?, Never>?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "link-sheet")

    /// - Parameters:
    ///   - resolve: Nil when there is no server to ask, which saves as offline does.
    ///   - debounce: How long typing must pause before the link is looked up.
    public init(
        store: CrosstuneStore, tuneID: String, resolve: Resolve?, debounce: Duration = .milliseconds(400)
    ) {
        self.store = store
        self.tuneID = tuneID
        self.resolve = resolve
        self.debounce = debounce
    }

    /// Whether the sheet holds typing a dismissal would lose.
    public var isEdited: Bool { !url.isEmpty || !label.isEmpty }

    /// Takes the link as typed or pasted, and looks it up once typing pauses.
    public func setURL(_ url: String) {
        self.url = url
        validation = nil
        failure = nil
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != lookupURL else { return }
        debounceTask?.cancel()
        lookup?.cancel()
        lookup = nil
        lookupURL = nil
        preview = nil
        guard resolve != nil, LinkText.outboundURL(trimmed) != nil else { return }
        lookupURL = trimmed
        let debounce = debounce
        debounceTask = Task { [weak self] in
            do {
                try await Task.sleep(for: debounce)
            } catch {
                return
            }
            guard let self, lookupURL == trimmed, lookup == nil else { return }
            startLookup(trimmed)
        }
    }

    /// What the server finds at `url`. The lookup made while pasting is reused, and one still
    /// waiting for typing to pause starts now.
    private func resolution(for url: String) async -> ResolvedLink? {
        guard lookupURL == url else { return await resolve?(url) }
        if let lookup { return await lookup.value }
        debounceTask?.cancel()
        return await startLookup(url).value
    }

    /// Asks the server about `url` and shows the title it finds, unless the link has changed by
    /// the time it answers.
    @discardableResult
    private func startLookup(_ url: String) -> Task<ResolvedLink?, Never> {
        let resolve = resolve
        let task = Task { await resolve?(url) }
        lookup = task
        Task { [weak self] in
            let resolved = await task.value
            guard let self, lookupURL == url else { return }
            preview = resolved?.title
        }
        return task
    }

    public func setLabel(_ label: String) {
        self.label = label
        failure = nil
    }

    /// Adds the link. True once the save lands; false when it could not run or failed, with the
    /// reason in ``validation`` or ``failure``.
    public func save() async -> Bool {
        guard !isSaving, !isSaved else { return false }
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            failure = nil
            validation = Self.linkRequired
            return false
        }
        guard LinkText.outboundURL(trimmed) != nil else {
            failure = nil
            validation = Self.linkNotWeb
            return false
        }
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        validation = nil
        failure = nil
        isSaving = true
        defer { isSaving = false }
        // Metadata is a nicety; a link the resolver cannot reach still gets added.
        let resolved = await resolution(for: trimmed)
        let input = Self.input(trimmed, resolved: resolved, label: trimmedLabel.isEmpty ? nil : trimmedLabel)
        do {
            try await Commands(store: store).addLink(tuneID: tuneID, link: input)
            isSaved = true
            return true
        } catch {
            Self.logger.warning("A link save failed: \(error)")
            failure = ListModel.message(error)
            return false
        }
    }

    /// Stops any lookup still waiting or running, as the sheet closes, so a link the musician
    /// walked away from spends none of their lookups.
    public func cancel() {
        debounceTask?.cancel()
        lookup?.cancel()
        debounceTask = nil
        lookup = nil
        lookupURL = nil
    }

    /// What gets stored for a pasted link. A provider the server named that this build does not
    /// know cannot carry that provider's ref either, since a ref's format is the provider's own,
    /// so the provider detected from the URL stands in.
    nonisolated static func input(_ url: String, resolved: ResolvedLink?, label: String?) -> LinkInput {
        let detected = detectProvider(url)
        let (provider, providerRef) =
            if let resolved, Vocabulary.providers.contains(resolved.provider) {
                (resolved.provider, resolved.providerRef)
            } else {
                (detected.provider, detected.providerRef)
            }
        return LinkInput(
            url: resolved?.url ?? url, provider: provider, providerRef: providerRef, title: resolved?.title,
            artworkURL: resolved?.artworkURL, label: label)
    }
}
