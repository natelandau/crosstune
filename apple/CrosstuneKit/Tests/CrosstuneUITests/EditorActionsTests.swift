import Testing

/// The trim and split editors end through one library action bar, which draws each platform's
/// place for Cancel and Save, so neither screen forks its actions by platform.
struct EditorActionsTests {
    private static let editors = ["RecordingScreen/TrimScreen.swift", "RecordingScreen/SplitScreen.swift"]

    private static func code(_ path: String) throws -> String {
        SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: path)))
    }

    @Test func editorsDrawNoPlatformFork() throws {
        for path in Self.editors {
            let text = try Self.code(path)
            #expect(text.contains(try Regex(#"\.editorActions\s*[({]"#)), "\(path) ends through the editor action bar")
            let macOnly = SourceScan.macOSRegions(of: text)
            let iOSOnly = SourceScan.iOSCompiled(text).split(separator: "\n").filter {
                !SourceScan.macCompiled(text).split(separator: "\n").contains($0)
            }.joined(separator: "\n")
            for platformOnly in [macOnly, iOSOnly] {
                for action in ["cancelButton", "saveButton", ".toolbar", ".paneBar"] {
                    #expect(platformOnly.contains(action) == false, "\(path) draws \(action) on one platform only")
                }
            }
        }
    }

    /// On the Mac, Escape presses Cancel and Return presses Save's own button. Return reaches
    /// Save through the environment rather than wrapping the Save view, so a confirm dialog that
    /// Save presents inherits no Return.
    @Test func editorKeysReachOnlyCancelAndSaveButtons() throws {
        let actions = SourceScan.macOSRegions(of: try Self.code("Phone/Controls/EditorActions.swift"))
        let cancelKey = #"\bcancel\s*\.buttonStyle\(\.\w+\)\s*\.keyboardShortcut\(\.cancelAction\)"#
        let saveKey = #"\bsave\s*\.buttonStyle\(\.\w+\)\s*\.environment\(\\\.editorSaveShortcut, \.defaultAction\)"#
        #expect(actions.contains(try Regex(cancelKey)))
        #expect(actions.contains(try Regex(saveKey)))
        #expect(actions.contains(".keyboardShortcut(.defaultAction)") == false)

        let save = try Self.code("RecordingScreen/EditorSaveButton.swift")
        #expect(save.contains(try Regex(#"@Environment\(\\\.editorSaveShortcut\)\s*private\s+var\s+shortcut"#)))
        let button = try #require(save.range(of: "Button {"))
        let shortcut = try #require(save.range(of: ".keyboardShortcut(shortcut)"))
        let dialog = try #require(save.range(of: ".confirmationDialog("))
        #expect(button.upperBound < shortcut.lowerBound && shortcut.upperBound < dialog.lowerBound)
    }

    /// On the Mac, `openURL` changes on every update while an editor is pushed over the recording
    /// page, so a page body that reads it redraws without end and the app hangs. Only the menu,
    /// which opens the origin, reads it.
    @Test func recordingPageReadsNoOpenURL() throws {
        #expect((try Self.code("RecordingPage/RecordingPage.swift")).contains(#"\.openURL"#) == false)
        #expect(try Self.code("RecordingPage/RecordingPageMenu.swift").contains(#"@Environment(\.openURL)"#))
    }

    /// Split at never takes the one Filled look away from Save, so it draws through the library's
    /// editor main action, with no platform fork of its own.
    @Test func splitMainButtonDrawsNoPlatformFork() throws {
        let text = try Self.code("RecordingScreen/SplitMainButton.swift")
        #expect(text.contains("#if os(") == false)
        #expect(text.contains(".editorMainAction()"))
    }
}
