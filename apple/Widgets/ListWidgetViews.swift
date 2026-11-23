import CrosstunePalette
import CrosstuneWidgetData
import CrosstuneWidgetIntents
import SwiftUI
import WidgetKit

/// The List widget at the small size, also shown in StandBy: the name, a count or the playing
/// tune, and Play and Shuffle.
struct SmallListView: View {
    let state: ListWidgetState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let list = state.list {
                ListName(name: list.name)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                PlayButton(state: state)
                ShuffleButton(state: state)
            }
        }
        .padding(.top, 4)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var subtitle: String {
        guard let tune = state.currentTune else { return state.statusText }
        return "\(state.statusText) · \(tune.title)"
    }
}

/// The List widget at the medium, large, and extra large sizes: the heading row, the tunes, and
/// the page buttons when the list has more pages.
struct ListRowsView: View {
    let state: ListWidgetState
    let size: ListWidgetSize
    let page: Int

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    if let list = state.list {
                        ListName(name: list.name).lineLimit(1)
                    }
                    if let count = state.count {
                        Text(count.text)
                            .font(.caption)
                            .foregroundStyle(Palette.textSecondary)
                    }
                }
                .padding(.leading, 8)
                Spacer(minLength: 0)
                ShuffleButton(state: state)
                PlayButton(state: state)
            }
            .frame(minHeight: 44)
            rows
            Spacer(minLength: 0)
            if let pager = state.pager(for: size, page: page), let list = state.list {
                PageButtons(pager: pager, listID: list.id, size: size)
            }
        }
    }

    @ViewBuilder private var rows: some View {
        let tunes = state.tunes(for: size, page: page)
        if size == .extraLarge {
            let half = (size.tunesPerPage + 1) / 2
            HStack(alignment: .top, spacing: 16) {
                TuneColumn(state: state, tunes: Array(tunes.prefix(half)))
                TuneColumn(state: state, tunes: Array(tunes.dropFirst(half)))
            }
        } else {
            TuneColumn(state: state, tunes: tunes)
        }
    }
}

/// Tunes one under another, with a line between rows. The current row's tint takes the place of
/// the line below it.
private struct TuneColumn: View {
    let state: ListWidgetState
    let tunes: [WidgetListTune]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(tunes.enumerated(), id: \.element.id) { index, tune in
                let isCurrent = tune.id == state.currentTune?.id
                let followsCurrent = index > 0 && tunes[index - 1].id == state.currentTune?.id
                if index > 0 && !followsCurrent {
                    Rectangle()
                        .fill(Palette.border)
                        .frame(height: 1)
                }
                if let list = state.list {
                    TuneRow(
                        list: list, tune: tune, isCurrent: isCurrent,
                        isPlaying: isCurrent && state.playback?.isPlaying == true)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// One tune: a tap starts the list from it and opens the app.
private struct TuneRow: View {
    let list: WidgetList
    let tune: WidgetListTune
    /// The tune the list is on, playing or paused, which gets the app's playing-row tint.
    let isCurrent: Bool
    let isPlaying: Bool

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(
            intent: PlayListFromTuneIntent(
                list: ListEntity(id: list.id, name: list.name), tune: TuneEntity(id: tune.id, title: tune.title))
        ) {
            HStack(spacing: 8) {
                Text(tune.title)
                    .fontWeight(isCurrent ? .semibold : .regular)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if isPlaying {
                    Text(WidgetText.playing)
                        .font(.footnote)
                        .foregroundStyle(Palette.accent)
                } else if let detail = tune.detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(isCurrent ? Palette.accent : Palette.textSecondary)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
            }
            .font(.subheadline)
            .foregroundStyle(Palette.textPrimary)
            .padding(.horizontal, isCurrent ? 12 : 8)
            .frame(minHeight: 44)
            .background {
                if isCurrent {
                    RoundedRectangle(cornerRadius: 10).fill(Palette.tintSubtle(colorScheme))
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// Back, "1 of 3", and forward. They change the page without opening the app.
private struct PageButtons: View {
    let pager: ListWidgetPager
    let listID: String
    let size: ListWidgetSize

    var body: some View {
        HStack {
            PageButton(
                listID: listID, size: size, shownPage: pager.page, page: pager.previousPage,
                systemImage: "chevron.left", label: WidgetText.previousPage)
            Spacer(minLength: 0)
            Text(WidgetText.position(pager.page + 1, of: pager.pageCount))
                .font(.footnote)
                .foregroundStyle(Palette.textSecondary)
            Spacer(minLength: 0)
            PageButton(
                listID: listID, size: size, shownPage: pager.page, page: pager.nextPage,
                systemImage: "chevron.right", label: WidgetText.nextPage)
        }
        .padding(.horizontal, 4)
    }
}

/// A page button. On the first or last page it stays in place, in the color of a glyph that
/// cannot act, and disabled.
private struct PageButton: View {
    let listID: String
    let size: ListWidgetSize
    /// The page on screen, which a disabled button names so a tap that gets through changes nothing.
    let shownPage: Int
    /// The page a tap shows, or nil when there is none that way.
    let page: Int?
    let systemImage: String
    let label: String

    var body: some View {
        Button(intent: ShowListPageIntent(widgetListID: listID, size: size, page: page ?? shownPage)) {
            Image(systemName: systemImage)
                .font(.body.weight(.medium))
                .foregroundStyle(page == nil ? Palette.textTertiary : Palette.accent)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(page == nil)
        .accessibilityLabel(label)
    }
}

/// Play the list from the top, or Pause and resume it while it plays: the app's filled button.
private struct PlayButton: View {
    let state: ListWidgetState

    var body: some View {
        if let action = state.playButton, let list = state.list {
            ListActionButton(action: action, list: list) {
                CircleButtonLabel(
                    title: action == .pause ? PlaybackLabels.pause : PlaybackLabels.play,
                    systemImage: action == .pause ? "pause.fill" : "play.fill",
                    fill: Palette.accentFill, foreground: Palette.onAccentFill
                )
                .widgetAccentable()
            }
        }
    }
}

/// Start the list in random order: the app's tinted button, or a neutral fill in dark mode,
/// where the tinted icon is hard to see.
private struct ShuffleButton: View {
    let state: ListWidgetState

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if state.playButton != nil, let list = state.list {
            ListActionButton(action: .play(shuffled: true), list: list) {
                CircleButtonLabel(
                    title: ListLabels.shuffle, systemImage: "shuffle",
                    fill: colorScheme == .dark ? Palette.field : Palette.tint(colorScheme),
                    foreground: colorScheme == .dark ? Palette.textPrimary : Palette.accent)
            }
        }
    }
}

/// A symbol in a filled circle, the label of Play and Shuffle.
private struct CircleButtonLabel: View {
    let title: String
    let systemImage: String
    let fill: Color
    let foreground: Color

    var body: some View {
        Image(systemName: systemImage)
            .font(.body.bold())
            .foregroundStyle(foreground)
            .frame(width: 44, height: 44)
            .background(fill, in: .circle)
            .contentShape(.circle)
            .accessibilityLabel(title)
    }
}

/// The list's name, marked as accented so it keeps the tint in the tinted and clear modes.
private struct ListName: View {
    let name: String

    var body: some View {
        Text(name)
            .font(.headline.bold())
            .foregroundStyle(Palette.textPrimary)
            .widgetAccentable()
    }
}

/// The picked list has no tunes. A tap opens it in the app, where tunes are added.
struct EmptyListView: View {
    let list: WidgetList

    var body: some View {
        ListActionButton(action: .openList, list: list) {
            VStack(alignment: .leading, spacing: 0) {
                ListName(name: list.name)
                Text(WidgetText.emptyList)
                    .font(.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
            .padding(.top, 4)
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .contentShape(.rect)
        }
    }
}

/// No list is picked, or the picked one was deleted.
struct ChooseListView: View {
    var body: some View {
        Button(intent: OpenAppIntent()) {
            VStack(spacing: 6) {
                Text(WidgetText.chooseList)
                    .font(.subheadline.bold())
                    .foregroundStyle(Palette.textPrimary)
                Text(WidgetText.chooseListHint)
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecondary)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// The List widget as a lock screen rectangle, in the system's one tint. The whole widget is one
/// tap target.
struct AccessoryRectangularListView: View {
    let state: ListWidgetState

    var body: some View {
        if let list = state.list {
            ListActionButton(action: state.lockScreenTap, list: list) {
                AccessoryListLines(state: state, list: list)
            }
        } else {
            Button(intent: OpenAppIntent()) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(WidgetText.chooseList).font(.headline)
                    Text(WidgetText.chooseListHint)
                        .font(.caption)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
    }
}

/// The lock screen rectangle's lines for a picked list: its name, then its count or the playing
/// tune.
private struct AccessoryListLines: View {
    let state: ListWidgetState
    let list: WidgetList

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(list.name)
                .font(.headline)
                .widgetAccentable()
            switch state {
            case .empty:
                Text(WidgetText.emptyList)
            case .ready:
                Text(state.count?.text ?? "")
                Text(WidgetText.tapToPlay)
            case .active:
                Text(state.statusText)
                if let tune = state.currentTune {
                    Text(tune.title)
                }
            default:
                EmptyView()
            }
        }
        .lineLimit(1)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .contentShape(.rect)
    }
}

/// Runs the intent for a List widget action.
private struct ListActionButton<Label: View>: View {
    let action: ListWidgetAction
    let list: WidgetList
    @ViewBuilder let label: Label

    private var entity: ListEntity { ListEntity(id: list.id, name: list.name) }

    var body: some View {
        Group {
            switch action {
            case .play(let shuffled): Button(intent: PlayListIntent(list: entity, shuffled: shuffled)) { label }
            case .pause: Button(intent: PauseListIntent()) { label }
            case .resume: Button(intent: ResumeListIntent()) { label }
            case .openList: Button(intent: OpenListIntent(list: entity)) { label }
            case .openApp: Button(intent: OpenAppIntent()) { label }
            }
        }
        .buttonStyle(.plain)
    }
}

extension ListWidgetState {
    /// "Playing" while the list plays, else the count beside its name.
    fileprivate var statusText: String {
        playback?.isPlaying == true ? WidgetText.playing : count?.text ?? ""
    }
}

extension ListWidgetCount {
    /// "12 tunes", or "2 of 12" while the list plays.
    fileprivate var text: String {
        switch self {
        case .tunes(let count): ListLabels.tunes(count)
        case .position(let position, let count): WidgetText.position(position, of: count)
        }
    }
}
