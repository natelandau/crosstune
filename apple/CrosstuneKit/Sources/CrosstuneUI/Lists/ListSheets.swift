import SwiftUI

/// Opens the list sheets the shell presents once, over every screen.
public struct ListSheetActions {
    private let naming: @MainActor (ListNameTarget) -> Void
    private let picking: @MainActor (ListPickerRequest) -> Void

    public init(
        name: @escaping @MainActor (ListNameTarget) -> Void, pick: @escaping @MainActor (ListPickerRequest) -> Void
    ) {
        naming = name
        picking = pick
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
    @Environment(\.tuneScreenActions) private var tuneScreenActions
    @Environment(\.openSheets) private var openSheets

    func body(content: Content) -> some View {
        content
            .environment(\.listSheets, ListSheetActions(name: { naming = $0 }, pick: { picking = $0 }))
            .environment(\.tuneScreenActions, withAddToList)
            .focusedSceneValue(
                \.newListAction,
                MenuGates.newList(sheetsOpen: openSheets?.isCovered == true) ? MenuAction { naming = .new } : nil
            )
            .sheet(item: $naming) { target in
                ListNameSheet(target: target)
            }
            .sheet(item: $picking) { request in
                ListPickerSheet(request: request)
            }
    }

    /// The tune screen's actions as set further out, with Add to list opening the picker.
    private var withAddToList: TuneScreenActions {
        var actions = tuneScreenActions
        actions.addToList = { userTuneID in
            picking = ListPickerRequest(userTuneIDs: [userTuneID], title: ListPickerSheet.tuneTitle)
        }
        return actions
    }
}
