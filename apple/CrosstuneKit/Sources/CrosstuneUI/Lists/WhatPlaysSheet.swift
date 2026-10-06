import CrosstuneAudio
import CrosstuneCommands
import SwiftUI

/// Words the What plays sheet shows.
public enum WhatPlaysText {
    public static let title = "What plays"
    public static let lead =
        "Lists play your recordings and full Apple Music tracks. Other links play from each tune's play button."
    public static let nothing = "No recordings or links"
    public static let noCapableLink = "Only links that can't play in a list"
    public static let needsSubscription = "Apple Music needs a subscription on this device"
    public static let needsConnection = "Apple Music needs a connection"
    public static let recordingsNotHere = "Recordings that aren't on this device yet"
    public static let allow = "Allow Apple Music"
    public static let openSettings = "Open Settings"
    public static let done = "Done"

    public static func groupTitle(_ reason: PlaylistSkip) -> String {
        switch reason {
        case .nothing: nothing
        case .noCapableLink: noCapableLink
        case .needsSubscription: needsSubscription
        case .needsConnection: needsConnection
        case .recordingsNotHere: recordingsNotHere
        }
    }

    /// The groups in the order the sheet shows them, without the empty ones.
    static func groups(_ report: PlaylistReport) -> [(reason: PlaylistSkip, tuneIDs: [String])] {
        let order: [PlaylistSkip] = [
            .nothing, .noCapableLink, .needsSubscription, .needsConnection, .recordingsNotHere,
        ]
        return order.compactMap { reason in
            guard let ids = report.skipped[reason], !ids.isEmpty else { return nil }
            return (reason, ids)
        }
    }
}

/// The tunes a list leaves out when it plays, grouped by why, with the way to fix the ones Apple
/// Music access can.
struct WhatPlaysSheet: View {
    let report: PlaylistReport
    let titles: [String: String]
    /// Nil until read, or when this device has no Apple Music player.
    let access: AppleMusicAccessState?
    let onChoose: (String) -> Void
    let onAllow: () -> Void
    let onOpenSettings: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(WhatPlaysText.lead)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(WhatPlaysText.groups(report), id: \.reason) { group in
                    Section(WhatPlaysText.groupTitle(group.reason)) {
                        ForEach(group.tuneIDs, id: \.self) { id in
                            Button {
                                onChoose(id)
                                dismiss()
                            } label: {
                                Text(titles[id] ?? "")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                        if group.reason == .needsSubscription { accessButton }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(WhatPlaysText.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(WhatPlaysText.done) { dismiss() }
                }
            }
        }
        .macSheetFrame(MacSheetSize(minWidth: 420, minHeight: 420, idealHeight: 520))
        .shellSheet()
    }

    @ViewBuilder private var accessButton: some View {
        switch access.map(AppleMusicRowAction.make) ?? .none {
        case .request: Button(WhatPlaysText.allow, action: onAllow)
        case .openSystemSettings: Button(WhatPlaysText.openSettings, action: onOpenSettings)
        case .none: EmptyView()
        }
    }
}
