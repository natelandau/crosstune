import SwiftUI

/// Opens the list sheets the shell presents once, over every screen. Equal when the same host
/// supplied them, whose closures reach only its own state, so its redraws reach no reader.
public struct ListSheetActions: Equatable {
    private let naming: @MainActor (ListNameTarget) -> Void
    private let picking: @MainActor (ListPickerRequest) -> Void
    private let source: UUID

    /// - Parameter source: The supplying host's stable id. Left out, the actions equal no other.
    public init(
        source: UUID = UUID(), name: @escaping @MainActor (ListNameTarget) -> Void,
        pick: @escaping @MainActor (ListPickerRequest) -> Void
    ) {
        self.source = source
        naming = name
        picking = pick
    }

    public static func == (lhs: ListSheetActions, rhs: ListSheetActions) -> Bool {
        lhs.source == rhs.source
    }

    /// Opens the list name sheet, to make a list or rename one.
    @MainActor public func name(_ target: ListNameTarget) {
        naming(target)
    }

    /// Opens the list picker over some tunes.
    @MainActor public func pick(_ request: ListPickerRequest) {
        picking(request)
    }
}

extension EnvironmentValues {
    /// The list sheets. Supplied by the shell; nil outside it.
    @Entry public var listSheets: ListSheetActions?
}

/// The list sheets any screen can ask for, presented once, over the whole shell.
struct ListSheets: ViewModifier {
    @State private var naming: ListNameTarget?
    @State private var picking: ListPickerRequest?
    @State private var source = UUID()
    @Environment(\.tuneScreenActions) private var tuneScreenActions
    @Environment(\.openSheets) private var openSheets
    @Environment(\.playerWindow) private var window

    func body(content: Content) -> some View {
        content
            .environment(\.listSheets, ListSheetActions(source: source, name: { naming = $0 }, pick: { picking = $0 }))
            .environment(\.tuneScreenActions, withAddToList)
            .focusedSceneValue(
                \.newListAction,
                MenuCommandAvailability.newList(sheetsOpen: openSheets?.isCovered == true)
                    ? MenuAction(id: ShellActionID.newList(window: window)) { naming = .new } : nil
            )
            .sheet(item: $naming) { target in
                ListNameSheet(target: target)
            }
            .sheet(item: $picking) { request in
                ListPickerSheet(request: request)
            }
            #if DEBUG
                .opensForSample(.listNew) { naming = .new }
            #endif
    }

    /// The tune screen's actions as set further out, with Add to list opening the picker.
    private var withAddToList: TuneScreenActions {
        tuneScreenActions.supplied(by: source) { actions in
            actions.addToList = { userTuneID in
                picking = ListPickerRequest(userTuneIDs: [userTuneID], title: ListPickerSheet.tuneTitle)
            }
        }
    }
}
