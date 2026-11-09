#if DEBUG
    import SwiftUI

    /// Every library control in every state it can hold at rest, grouped as the design groups
    /// them, with placeholder content only. Pressed, working, and motion states show on a press.
    /// `-ControlGalleryScroll <heading>` in the launch arguments opens scrolled to the section or
    /// item with that heading, so a capture reaches it without a swipe. Debug builds only.
    package struct ControlGallery: View {
        @State private var scheme: ColorScheme?
        @State private var textSize: DynamicTypeSize?
        @Environment(\.colorScheme) private var systemScheme
        @Environment(\.dynamicTypeSize) private var systemTextSize

        package init() {}

        package var body: some View {
            NavigationStack {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 40) {
                            GallerySettings(scheme: $scheme, textSize: $textSize)
                            ActionsSection()
                            AudioSection()
                            NavigationSection()
                            ChoicesSection()
                            ValuesSection()
                            FormsSection()
                            StatusSection()
                            MotionSection()
                        }
                        .padding(16)
                        .frame(maxWidth: 680)
                        .frame(maxWidth: .infinity)
                    }
                    .onAppear {
                        if let heading = UserDefaults.standard.string(forKey: "ControlGalleryScroll") {
                            proxy.scrollTo(heading, anchor: .top)
                        }
                    }
                }
                .background(Palette.pageBackground.ignoresSafeArea())
                .navigationTitle("Controls")
            }
            .environment(\.colorScheme, scheme ?? systemScheme)
            .dynamicTypeSize(textSize ?? systemTextSize)
        }
    }

    // MARK: - Layout

    private struct GallerySection<Content: View>: View {
        let heading: String
        @ViewBuilder let content: Content

        var body: some View {
            VStack(alignment: .leading, spacing: 24) {
                Text(heading)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Palette.textPrimary)
                    .id(heading)
                content
            }
        }
    }

    private struct GalleryItem<Content: View>: View {
        let heading: String
        @ViewBuilder let content: Content

        var body: some View {
            VStack(alignment: .leading, spacing: 12) {
                Text(heading)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.textSecondary)
                    .id(heading)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// A row that stacks its items at the accessibility text sizes, where side by side they
    /// would truncate.
    private struct AdaptiveStack<Content: View>: View {
        @ViewBuilder let content: Content
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize

        var body: some View {
            let layout =
                dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
            layout { content }
        }
    }

    private struct GallerySettings: View {
        @Binding var scheme: ColorScheme?
        @Binding var textSize: DynamicTypeSize?

        var body: some View {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Appearance", selection: $scheme) {
                    Text("System").tag(ColorScheme?.none)
                    Text("Light").tag(ColorScheme?.some(.light))
                    Text("Dark").tag(ColorScheme?.some(.dark))
                }
                .pickerStyle(.segmented)
                Picker("Text size", selection: $textSize) {
                    Text("System").tag(DynamicTypeSize?.none)
                    ForEach(DynamicTypeSize.allCases, id: \.self) { size in
                        Text(verbatim: "\(size)").tag(DynamicTypeSize?.some(size))
                    }
                }
                .pickerStyle(.menu)
            }
        }
    }

    // MARK: - Actions

    private struct ActionsSection: View {
        @State private var failure: String?
        @State private var shuffles = false
        @State private var repeats = true

        var body: some View {
            GallerySection(heading: "Actions") {
                GalleryItem(heading: "Button: LibraryButtonStyle") {
                    FlowLayout(spacing: 12) {
                        Button {
                        } label: {
                            Label("Play", systemImage: "play.fill")
                        }
                        .buttonStyle(.filled)
                        Button {
                        } label: {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(.tinted)
                        Button("Edit") {}.buttonStyle(.text)
                    }
                    FlowLayout(spacing: 12) {
                        Button("Add") {}.buttonStyle(.filled).controlSize(.small)
                        Button("Options") {}.buttonStyle(.tinted).controlSize(.small)
                        Button("Delete", role: .destructive) {}.buttonStyle(.tinted)
                        Button("Remove", role: .destructive) {}.buttonStyle(.text)
                    }
                    Button("Continue") {}.buttonStyle(.filled).controlSize(.large)
                    Text("Disabled")
                        .font(.caption)
                        .foregroundStyle(Palette.textSecondary)
                    FlowLayout(spacing: 12) {
                        Button("Save") {}.buttonStyle(.filled)
                        Button("Share") {}.buttonStyle(.tinted)
                        Button("Edit") {}.buttonStyle(.text)
                    }
                    .disabled(true)
                }
                GalleryItem(heading: "Working, then done: AsyncButton") {
                    FlowLayout(spacing: 12) {
                        AsyncButton("Sync now", action: { try await Task.sleep(for: .milliseconds(1800)) }) { _ in }
                            .buttonStyle(.tinted)
                        AsyncButton("Save", action: { try await Task.sleep(for: .milliseconds(150)) }) { _ in }
                            .buttonStyle(.filled)
                        AsyncButton(
                            "Restore purchases",
                            action: {
                                failure = nil
                                try await Task.sleep(for: .milliseconds(2400))
                                throw GalleryFailure()
                            },
                            onFailure: { _ in failure = "The action did not finish." }
                        )
                        .buttonStyle(.text)
                    }
                    if let failure {
                        Text(failure)
                            .font(.footnote)
                            .foregroundStyle(Palette.danger)
                    }
                }
                GalleryItem(heading: "Working, for work after a question: WorkingLabel") {
                    Button {
                    } label: {
                        WorkingLabel(phase: .working) { Text("Save") }
                    }
                    .buttonStyle(.filled)
                }
                GalleryItem(heading: "Icon button: IconButtonStyle") {
                    FlowLayout(spacing: 12) {
                        Button {
                        } label: {
                            Image(systemName: "forward.fill")
                        }
                        .buttonStyle(.icon)
                        .accessibilityLabel("Next")
                        Button {
                        } label: {
                            Image(systemName: "minus")
                        }
                        .buttonStyle(.icon(.circled))
                        .accessibilityLabel("Decrease")
                        Button {
                        } label: {
                            Image(systemName: "plus")
                        }
                        .buttonStyle(.icon(.circled))
                        .accessibilityLabel("Increase")
                        Button {
                            shuffles.toggle()
                        } label: {
                            Image(systemName: "shuffle")
                        }
                        .buttonStyle(.icon(isOn: shuffles))
                        .accessibilityLabel("Shuffle")
                        Button {
                            repeats.toggle()
                        } label: {
                            Image(systemName: "repeat")
                        }
                        .buttonStyle(.icon(isOn: repeats))
                        .accessibilityLabel("Repeat")
                        Button {
                        } label: {
                            Text("AB")
                        }
                        .buttonStyle(.icon(.tintDisc))
                        .accessibilityLabel("Account")
                        Button {
                        } label: {
                            Image(systemName: "person.fill")
                        }
                        .buttonStyle(.icon(.tintDisc))
                        .accessibilityLabel("Account")
                        Button {
                        } label: {
                            Image(systemName: "plus")
                        }
                        .buttonStyle(.icon(.circled))
                        .disabled(true)
                        .accessibilityLabel("Increase")
                    }
                }
                GalleryItem(heading: "Row buttons: RowButtonStyle") {
                    VStack(spacing: 0) {
                        Button {
                        } label: {
                            Text("Opens an editor")
                                .padding(.horizontal, 12)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.rowHighlight(radius: 8))
                        Button("A line that opens a tune") {}
                            .buttonStyle(.rowLine)
                        Button {
                        } label: {
                            Text("A row that picks a value").frame(
                                maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.pickRow)
                        Button {
                        } label: {
                            Text("A form row that picks a value")
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.formPickRow)
                        Button("Accent words") {}
                            .buttonStyle(.accentWords)
                        Button("Accent words, the Mac's plain button") {}
                            .buttonStyle(.accentWords(macLook: .plain))
                    }
                }
                GalleryItem(heading: "Label only: LabelOnlyButtonStyle") {
                    HStack(spacing: 16) {
                        Button {
                        } label: {
                            Image(systemName: "play.circle").font(.title2).frame(width: 44, height: 44)
                        }
                        .buttonStyle(.labelOnly)
                        .accessibilityLabel("Play")
                        Button {
                        } label: {
                            Text("Tile")
                                // A fixed tile's type stops growing, as the key tile's does.
                                .dynamicTypeSize(...DynamicTypeSize.large)
                                .frame(width: 64, height: 64)
                                .background(Palette.field, in: .rect(cornerRadius: ControlMetrics.containerRadius))
                        }
                        .buttonStyle(.labelOnly(pressedOpacity: ControlMetrics.tilePressedOpacity))
                        .accessibilityShowsLargeContentViewer()
                        Button {
                        } label: {
                            Image(systemName: "person.fill")
                                .font(.footnote)
                                .frame(width: 32, height: 32)
                                .background(Palette.field, in: .circle)
                        }
                        .buttonStyle(.labelOnly(hoverShape: .circle))
                        .accessibilityLabel("Account")
                    }
                }
            }
        }
    }

    private struct GalleryFailure: Error {}

    // MARK: - Audio

    private struct AudioSection: View {
        @State private var featurePlaying = false
        @State private var edgesPlaying = true
        @State private var inlinePlaying = false

        var body: some View {
            GallerySection(heading: "Audio") {
                GalleryItem(heading: "Transport, feature") {
                    Transport(
                        isPlaying: featurePlaying, size: .feature,
                        onPlayPause: { featurePlaying.toggle() }, onBack: {}, onForward: {}
                    )
                    .frame(maxWidth: .infinity)
                    Transport(
                        isPlaying: edgesPlaying, size: .feature, sides: .edges, macLook: .glyphs,
                        onPlayPause: { edgesPlaying.toggle() }, onBack: {}, onForward: {}
                    )
                    .frame(maxWidth: .infinity)
                }
                GalleryItem(heading: "Transport, inline") {
                    Transport(
                        isPlaying: inlinePlaying, size: .inline,
                        onPlayPause: { inlinePlaying.toggle() }, onBack: {}, onForward: {}
                    )
                    .frame(maxWidth: .infinity)
                }
                GalleryItem(heading: "Transport, inline, play only") {
                    Transport(
                        isPlaying: inlinePlaying, size: .inline, sides: .hidden,
                        onPlayPause: { inlinePlaying.toggle() }
                    )
                    .frame(maxWidth: .infinity)
                }
                GalleryItem(heading: "Transport, at the start and unable to play") {
                    Transport(
                        isPlaying: false, size: .feature, canPlay: false, canGoBack: false,
                        onPlayPause: {}, onBack: {}, onForward: {}
                    )
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    // MARK: - Navigation

    private enum Mode: Hashable, CaseIterable {
        case speed, pitch, isolate, loops
    }

    private enum Place: Hashable {
        case nearby, saved, recent
    }

    private struct NavigationSection: View {
        @State private var mode = Mode.speed
        @State private var place = Place.saved
        @State private var solo = 0
        @State private var channel = 1

        var body: some View {
            GallerySection(heading: "Navigation") {
                GalleryItem(heading: "Tabs: PaneTabs") {
                    PaneTabs(
                        selection: $mode,
                        tabs: [
                            PaneTab(
                                .speed, title: "Speed", systemImage: "gauge.with.dots.needle.33percent",
                                valueText: "75%"),
                            PaneTab(.pitch, title: "Pitch", systemImage: "tuningfork"),
                            PaneTab(.isolate, title: "Isolate", systemImage: "waveform"),
                            PaneTab(.loops, title: "Loops", systemImage: "repeat", valueText: "2"),
                        ])
                    PaneTabs(
                        selection: $place,
                        tabs: [
                            PaneTab(.nearby, title: "Nearby", systemImage: "location"),
                            PaneTab(.saved, title: "Saved", systemImage: "bookmark"),
                            PaneTab(.recent, title: "Recent", systemImage: "clock"),
                        ])
                }
                GalleryItem(heading: "Segmented control") {
                    Picker("Mode", selection: $solo) {
                        Text("Solo").tag(0)
                        Text("Mute").tag(1)
                    }
                    .pickerStyle(.segmented)
                    Picker("Channel", selection: $channel) {
                        Text("Left").tag(0)
                        Text("Both").tag(1)
                        Text("Right").tag(2)
                    }
                    .pickerStyle(.segmented)
                }
            }
        }
    }

    // MARK: - Choices

    private struct ChoicesSection: View {
        @State private var share = "75%"
        @State private var times: Set<String> = ["0:48"]
        @State private var hasFilter = true
        @State private var isOn = true
        @State private var isOff = false
        @State private var place = 0
        @State private var items: Set<Int> = [0]
        @State private var yearly = true

        var body: some View {
            GallerySection(heading: "Choices") {
                GalleryItem(heading: "Chip") {
                    FlowLayout(spacing: 8) {
                        ForEach(["50%", "75%", "100%"], id: \.self) { value in
                            Chip(value, kind: .choice(isChosen: share == value)) { share = value }
                        }
                    }
                    FlowLayout(spacing: 8) {
                        ForEach(["0:12", "0:48", "1:24", "2:06"], id: \.self) { time in
                            Chip(time, kind: .choice(isChosen: times.contains(time))) {
                                if times.contains(time) { times.remove(time) } else { times.insert(time) }
                            }
                        }
                    }
                    FlowLayout(spacing: 8) {
                        Chip("Type", kind: .menu(isSet: false)) {}
                        Chip("Reel", kind: .menu(isSet: true)) {}
                        if hasFilter {
                            Chip("Option", kind: .removable) { hasFilter = false }
                        } else {
                            Chip("Restore", kind: .menu(isSet: false)) { hasFilter = true }
                        }
                        ChipMenu(isSet: hasFilter) {
                            Toggle("Filtered", isOn: $hasFilter)
                        } label: {
                            Text("Menu")
                        }
                        Chip("Group name", kind: .token) {}
                        Chip("Known", kind: .tone(.statusKnown)) {}
                        Chip("Disabled", kind: .choice(isChosen: false)) {}.disabled(true)
                    }
                    Text("ChipLabel, standalone and compact")
                        .font(.caption)
                        .foregroundStyle(Palette.textSecondary)
                    FlowLayout(spacing: 8) {
                        ChipLabel("Value", kind: .choice(isChosen: true))
                        ChipLabel("Value", kind: .menu(isSet: true))
                        ChipLabel("Value", kind: .token, isCompact: true)
                        ChipLabel("List name", kind: .token, systemImage: "music.note.list")
                        ChipLabel("Learning", kind: .tone(.statusLearning), isCompact: true)
                    }
                }
                GalleryItem(heading: "Switch") {
                    HStack(spacing: 16) {
                        Toggle("On", isOn: $isOn)
                        Toggle("Off", isOn: $isOff)
                        Toggle("Disabled", isOn: .constant(true)).disabled(true)
                    }
                    .labelsHidden()
                    .toggleStyle(.accentSwitch)
                }
                GalleryItem(heading: "Selection mark: SelectionMark") {
                    VStack(spacing: 0) {
                        ForEach(0..<3, id: \.self) { index in
                            Button {
                                place = index
                            } label: {
                                HStack {
                                    Text(["First place", "Second place", "Third place"][index])
                                    Spacer(minLength: 8)
                                    SelectionMark(.single(isChosen: place == index))
                                }
                                .galleryRow()
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .galleryGroup()
                    VStack(spacing: 0) {
                        ForEach(0..<2, id: \.self) { index in
                            Button {
                                if items.contains(index) { items.remove(index) } else { items.insert(index) }
                            } label: {
                                HStack(spacing: 12) {
                                    SelectionMark(.multiple(isOn: items.contains(index)))
                                    Text(["First item", "Second item"][index])
                                    Spacer(minLength: 0)
                                }
                                .galleryRow()
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .galleryGroup()
                }
                GalleryItem(heading: "Option card: OptionCard") {
                    AdaptiveStack {
                        OptionCard(isChosen: yearly, action: { yearly = true }) {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 6) {
                                    Text("Yearly").font(.headline)
                                    Badge("Save 17%", kind: .brand)
                                }
                                Text("$29.99/year").font(.subheadline).foregroundStyle(Palette.textSecondary)
                            }
                        }
                        OptionCard(isChosen: !yearly, action: { yearly = false }) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Monthly").font(.headline)
                                Text("$2.99/month").font(.subheadline).foregroundStyle(Palette.textSecondary)
                            }
                        }
                    }
                    .foregroundStyle(Palette.textPrimary)
                }
                GalleryItem(heading: "Menu") {
                    Menu {
                        Button("Edit", systemImage: "pencil") {}
                        Button("Share", systemImage: "square.and.arrow.up") {}
                        Divider()
                        Button("Delete", systemImage: "trash", role: .destructive) {}
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .iconButtonMenuAppearance(.circled)
                    .accessibilityLabel("More")
                }
            }
        }
    }

    // MARK: - Values

    private struct ValuesSection: View {
        @State private var semitones = 2
        @State private var count = 12
        @State private var speed = 75
        @State private var cents = 0
        @State private var position = 42.0
        @State private var zoomed = false

        var body: some View {
            GallerySection(heading: "Values") {
                GalleryItem(heading: "Stepper: ValueStepper") {
                    HStack(spacing: 16) {
                        ValueStepper("Semitones", value: $semitones, in: -12...12) { signed($0) }
                        ValueStepper("Count", value: $count, in: 1...12) { "\($0)" }
                    }
                }
                GalleryItem(heading: "Label line: ValueLabelLine") {
                    ValueLabelLine("Semitones") {
                        ValueStepper("Semitones", value: $semitones, in: -12...12) { signed($0) }
                    }
                }
                GalleryItem(heading: "Slider: ValueSlider, off and on the default") {
                    ValueSlider("Speed", value: $speed, in: 50...125, step: 5, defaultValue: 100) { "\($0)%" }
                    ValueSlider("Cents", value: $cents, in: -50...50, step: 1, defaultValue: 0) { signed($0) }
                }
                GalleryItem(heading: "Range handles: RangeHandles") {
                    GalleryRange(isEnabled: true)
                    GalleryRange(isEnabled: false)
                }
                GalleryItem(heading: "Scrubber: PlaybackScrubber") {
                    PlaybackScrubber(
                        position: position, duration: 195, onScrub: { position = $0 }, onScrubEnd: { position = $0 })
                    PlaybackScrubber(position: 120, duration: 195, onScrub: { _ in }, onScrubEnd: { _ in })
                        .disabled(true)
                    PlaybackScrubber(
                        position: position, duration: 195, timesBeside: true, onScrub: { position = $0 },
                        onScrubEnd: { position = $0 })
                }
                GalleryItem(heading: "Zoom control: ZoomControl") {
                    AdaptiveStack {
                        ZoomControl(
                            canZoomOut: zoomed, canZoomIn: true, canFit: zoomed,
                            onZoomOut: { zoomed = false }, onFit: { zoomed = false }, onZoomIn: { zoomed = true })
                        ZoomControl(
                            canZoomOut: true, canZoomIn: false, canFit: true,
                            onZoomOut: {}, onFit: {}, onZoomIn: {})
                    }
                    ZoomControl(
                        canZoomOut: zoomed, canZoomIn: true, canFit: zoomed,
                        onZoomOut: { zoomed = false }, onFit: { zoomed = false }, onZoomIn: { zoomed = true },
                        aroundReadouts: { Text("1:12.3").monospacedDigit().frame(maxWidth: .infinity) })
                }
            }
        }

        private func signed(_ value: Int) -> String { value > 0 ? "+\(value)" : "\(value)" }
    }

    private struct GalleryRange: View {
        let isEnabled: Bool
        @State private var span = (start: 58.0, end: 132.0)
        @Environment(\.colorScheme) private var colorScheme

        private let duration = 195.0
        private let playhead = 101.0

        var body: some View {
            GalleryWaveform(playhead: playhead / duration) { width in
                RangeHandles(
                    start: span.start, end: span.end, duration: duration,
                    color: Palette.loop(0, scheme: colorScheme), wash: Palette.loopTint(0, scheme: colorScheme),
                    scale: { CGFloat($0 / duration) * width }, time: { Double($0 / max(width, 1)) * duration },
                    snapPoints: [60, 120], playhead: playhead, minimumLength: 0.5, movesSpan: true,
                    isEnabled: isEnabled,
                    onChange: { start, end in span = (start, end) }, onCommit: { _, _ in })
            }
        }
    }

    /// Placeholder audio bars with a playhead, the surface range handles sit on.
    private struct GalleryWaveform<Overlay: View>: View {
        let playhead: Double
        @ViewBuilder let overlay: (CGFloat) -> Overlay

        private static var bars: [Double] {
            (0..<64).map { index in
                let x = Double(index)
                return 0.25 + 0.6 * abs(sin(x * 0.37) * cos(x * 0.11))
            }
        }

        var body: some View {
            GeometryReader { proxy in
                let width = proxy.size.width
                ZStack(alignment: .leading) {
                    HStack(alignment: .center, spacing: 2) {
                        ForEach(Array(Self.bars.enumerated()), id: \.offset) { _, height in
                            Capsule()
                                .fill(Palette.textTertiary)
                                .frame(height: proxy.size.height * 0.8 * height)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .frame(maxHeight: .infinity)
                    Rectangle()
                        .fill(Palette.playhead)
                        .frame(width: 2)
                        .offset(x: width * playhead - 1)
                    overlay(width)
                }
            }
            .frame(height: 128)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: ControlMetrics.containerRadius))
        }
    }

    // MARK: - Forms and rows

    private struct FormsSection: View {
        @ScaledMetric(relativeTo: .body) private var formHeight: CGFloat = 520
        @State private var text = ""
        @State private var choice = 0
        @State private var setting = true
        @State private var singleLine = ""
        @State private var notes = ""
        @State private var summary = ""
        @State private var meter = "4/4"
        @State private var page: String? = "Chosen page"
        @ScaledMetric(relativeTo: .body) private var selectionFormHeight: CGFloat = 200

        var body: some View {
            GallerySection(heading: "Forms and rows") {
                GalleryItem(heading: "Form rows") {
                    GroupedForm {
                        Section {
                            LabeledContent("Name") {
                                TextField("Name", text: $text, prompt: Text("Not set"))
                                    .contentMask()
                                    .multilineTextAlignment(.trailing)
                            }
                            Picker("Picker", selection: $choice) {
                                Text("Choice").tag(0)
                                Text("Other choice").tag(1)
                            }
                            Toggle("Setting", isOn: $setting)
                            MenuRow("Menu row", value: meter) {
                                ForEach(["3/4", "4/4", "6/8"], id: \.self) { choice in
                                    Toggle(
                                        choice,
                                        isOn: Binding {
                                            meter == choice
                                        } set: { _ in
                                            meter = choice
                                        })
                                }
                            }
                            NavigationLink {
                                Text("Page")
                            } label: {
                                LabeledContent("Pushes a page", value: "Summary")
                            }
                            DisclosureRowButton(action: {}) {
                                LabeledContent("Opens a sheet") {
                                    Text("Summary").foregroundStyle(Palette.textSecondary)
                                }
                            }
                        } header: {
                            Text("Group heading")
                        } footer: {
                            Text("Help for the group: one or two sentences.")
                        }
                        Section {
                            AsyncButton("Sync now", action: { try await Task.sleep(for: .milliseconds(1800)) }) { _ in }
                        } footer: {
                            Text("Last synced 5 minutes ago.")
                        }
                        Section {
                            Button("Delete", role: .destructive) {}
                        }
                    }
                    // Scrolls inside its frame at the larger text sizes.
                    .frame(height: formHeight)
                    .clipShape(RoundedRectangle(cornerRadius: ControlMetrics.containerRadius))
                }
                GalleryItem(heading: "Selection form: GroupedSelectionForm") {
                    GroupedSelectionForm(selection: $page) {
                        Section {
                            ForEach(["A page", "Chosen page", "Another page"], id: \.self) { title in
                                LabeledContent(title, value: "Summary")
                                    .groupedSelectionRow(title, selection: page)
                            }
                        }
                    }
                    .frame(height: selectionFormHeight)
                    .clipShape(RoundedRectangle(cornerRadius: ControlMetrics.containerRadius))
                }
                GalleryItem(heading: "Text field: FilledTextFieldStyle") {
                    TextField("Placeholder", text: $singleLine).contentMask().textFieldStyle(.filled)
                    TextField("Notes", text: $notes, axis: .vertical).contentMask().textFieldStyle(.filledMultiline)
                }
                GalleryItem(heading: "Multiline field: MultilineTextField") {
                    MultilineTextField("Description", text: $summary, prompt: "Write a description")
                }
            }
        }
    }

    // MARK: - Status

    private struct StatusSection: View {
        var body: some View {
            GallerySection(heading: "Status") {
                GalleryItem(heading: "Badge") {
                    FlowLayout(spacing: 8) {
                        Badge("Archived")
                        Badge("75% · \u{2212}2")
                        Badge("Save 17%", kind: .brand)
                    }
                }
                GalleryItem(heading: "Status glyph") {
                    HStack(spacing: 16) {
                        StatusGlyph("unknown")
                        StatusGlyph("learning")
                        StatusGlyph("known")
                    }
                }
            }
        }
    }

    // MARK: - Motion moments

    private struct MotionSection: View {
        var body: some View {
            GallerySection(heading: "Motion moments") {
                GalleryItem(heading: "Tab panels slide toward the choice") { PanelMoment() }
                GalleryItem(heading: "A new loop opens from the playhead") { LoopMoment() }
                GalleryItem(heading: "A status change fills its ring") { StatusMoment() }
                GalleryItem(heading: "Undo puts it back where it was") { UndoMoment() }
            }
        }
    }

    private struct PanelMoment: View {
        @State private var mode = Mode.speed

        private var tabs: [PaneTab<Mode>] {
            [
                PaneTab(.speed, title: "Speed", systemImage: "gauge.with.dots.needle.33percent"),
                PaneTab(.pitch, title: "Pitch", systemImage: "tuningfork"),
                PaneTab(.isolate, title: "Isolate", systemImage: "waveform"),
                PaneTab(.loops, title: "Loops", systemImage: "repeat"),
            ]
        }

        var body: some View {
            VStack(spacing: 12) {
                PaneTabs(selection: $mode, tabs: tabs)
                PaneTabPanel(selection: mode, order: Mode.allCases) {
                    Text(verbatim: "\(mode) panel".capitalized)
                        .font(.headline)
                        .foregroundStyle(Palette.textPrimary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: ControlMetrics.containerRadius))
                }
                .frame(height: 96)
                .clipped()
            }
        }
    }

    private struct LoopMoment: View {
        @State private var loopID: Int?
        @State private var span = (start: 70.0, end: 130.0)
        @Environment(\.colorScheme) private var colorScheme

        private let duration = 195.0
        private let playhead = 88.0

        var body: some View {
            VStack(alignment: .leading, spacing: 12) {
                GalleryWaveform(playhead: playhead / duration) { width in
                    if let loopID {
                        RangeHandles(
                            start: span.start, end: span.end, duration: duration,
                            color: Palette.loop(1, scheme: colorScheme), wash: Palette.loopTint(1, scheme: colorScheme),
                            scale: { CGFloat($0 / duration) * width }, time: { Double($0 / max(width, 1)) * duration },
                            snapPoints: [], playhead: playhead, minimumLength: 0.5, movesSpan: true,
                            insertionID: loopID,
                            onChange: { start, end in span = (start, end) }, onCommit: { _, _ in })
                    }
                }
                AdaptiveStack {
                    Button {
                        span = (70, 130)
                        loopID = (loopID ?? 0) + 1
                    } label: {
                        Label("New loop", systemImage: "plus")
                    }
                    .buttonStyle(.tinted)
                    .controlSize(.small)
                    .disabled(loopID != nil)
                    Button("Delete loop", role: .destructive) { loopID = nil }
                        .buttonStyle(.tinted)
                        .controlSize(.small)
                        .disabled(loopID == nil)
                }
            }
        }
    }

    private struct StatusMoment: View {
        @State private var status = "learning"

        var body: some View {
            AdaptiveStack {
                HStack(spacing: 12) {
                    StatusGlyph(status)
                    Text(StatusStyle.label(status))
                        .foregroundStyle(Palette.textPrimary)
                }
                Spacer(minLength: 0)
                Button(status == "known" ? "Mark learning" : "Mark known") {
                    status = status == "known" ? "learning" : "known"
                }
                .buttonStyle(.tinted)
                .controlSize(.small)
            }
        }
    }

    private struct UndoMoment: View {
        @State private var rows = ["First item", "Second item", "Third item"]
        @State private var banner: UndoBannerItem?
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            VStack(spacing: 0) {
                ForEach(rows, id: \.self) { row in
                    AdaptiveStack {
                        Text(row).foregroundStyle(Palette.textPrimary)
                        Spacer(minLength: 0)
                        Button("Remove", role: .destructive) { remove(row) }
                            .buttonStyle(.text)
                    }
                    .galleryRow()
                    .restoredRow()
                }
            }
            .galleryGroup()
            .frame(minHeight: 132, alignment: .top)
            .padding(.bottom, 72)
            .undoBanner($banner)
        }

        private func remove(_ row: String) {
            guard let index = rows.firstIndex(of: row) else { return }
            withAnimation(PhoneMotion.resolve(reduceMotion: reduceMotion).animation(Motion.state)) {
                _ = rows.remove(at: index)
            }
            banner = UndoBannerItem(message: "Removed \u{201C}\(row)\u{201D}") {
                rows.insert(row, at: min(index, rows.count))
            }
        }
    }

    extension View {
        fileprivate func galleryRow() -> some View {
            frame(maxWidth: .infinity, minHeight: ControlMetrics.rowHeight, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
                .foregroundStyle(Palette.textPrimary)
                .contentShape(.rect)
        }

        fileprivate func galleryGroup() -> some View {
            background(Palette.surface, in: RoundedRectangle(cornerRadius: ControlMetrics.containerRadius))
        }
    }
#endif
