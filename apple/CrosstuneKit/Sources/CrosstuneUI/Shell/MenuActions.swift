import SwiftUI

/// Something a menu command does, published by the screen or shell that can do it. A command
/// whose action no focused view publishes is disabled.
public struct MenuAction {
    private let perform: @MainActor () -> Void

    public init(_ perform: @escaping @MainActor () -> Void) {
        self.perform = perform
    }

    @MainActor public func callAsFunction() {
        perform()
    }
}

/// The names of the app's menu commands.
public enum MenuCommand {
    public static let newTune = "New tune…"
    public static let newList = SidebarItem.newList
    public static let syncNow = "Sync now"
    public static let find = "Find"
}

extension FocusedValues {
    /// Opens the new tune form. Published by the shell.
    @Entry public var newTuneAction: MenuAction?
    /// Starts making a list. Published by the shell.
    @Entry public var newListAction: MenuAction?
    /// Opens the record sheet. Published by the shell.
    @Entry public var recordAction: MenuAction?
    /// Runs a sync now. Published by the shell while a store is open.
    @Entry public var syncNowAction: MenuAction?
    /// Focuses the search field of the screen that has one. Read on iPadOS only; on the Mac the
    /// system Find items reach a screen through its `.searchable` field.
    @Entry public var findAction: MenuAction?
}
