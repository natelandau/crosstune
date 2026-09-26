import SwiftUI

/// The loaded item and a close button: the iPhone tab bar's bottom accessory, where a tap on the
/// item shows its player in full, and the header of the iPad and Mac player panel. A recording
/// leads with its play and pause control.
public struct PlayerBar: View {
    public static let close = "Close player"
    /// The iPhone bar's name for the tap that shows the player in full.
    public static let show = "Show player"

    /// The link out to the provider's own page: "Open in YouTube".
    public static func openIn(_ providerName: String) -> String {
        "Open in \(providerName)"
    }

    private let player: PlayerModel
    private let isPanel: Bool

    /// - Parameter isPanel: The bar heads the iPad and Mac panel, which shows the player in
    ///   full under it and puts the link out to the provider in the bar. The iPhone's full
    ///   player carries that link instead.
    public init(player: PlayerModel, isPanel: Bool = false) {
        self.player = player
        self.isPanel = isPanel
    }

    public var body: some View {
        let isRecording = player.item?.kind == .recording
        HStack(spacing: 4) {
            if isRecording {
                RecordingPlayButton(player: player)
            }
            if isPanel {
                itemLabel(glyph: !isRecording)
            } else {
                Button(action: player.expand) {
                    itemLabel(glyph: !isRecording).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(Self.show), \(player.title ?? "")")
            }
            if isPanel, let link = player.item?.link, let url = link.providerURL {
                Link(destination: url) {
                    Label(Self.openIn(link.providerName), systemImage: "arrow.up.right")
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .foregroundStyle(.tint)
                .help(Self.openIn(link.providerName))
            }
            PlayerCloseButton(player: player)
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .padding(.leading, isRecording ? 6 : 16)
        .padding(.trailing, 4)
    }

    private func itemLabel(glyph: Bool) -> some View {
        HStack(spacing: 12) {
            if glyph {
                Image(systemName: "play.fill")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            Text(player.title ?? "")
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
    }
}

/// Unloads the player: the bar's close control and the iPhone full player's.
struct PlayerCloseButton: View {
    let player: PlayerModel

    var body: some View {
        Button(PlayerBar.close, systemImage: "xmark") { player.close() }
            .help(PlayerBar.close)
    }
}

/// The iPad and Mac player: the bar, with a loaded link's player or a recording's scrubber
/// under it.
struct PlayerPanel: View {
    /// The most of the window's height the panel takes, so a short window keeps its content.
    nonisolated static let maxShare: CGFloat = 0.4
    /// The web's width for a video player, so it is not stretched across the window.
    nonisolated static let videoWidth: CGFloat = 356
    /// The bar above the embed and the padding below it.
    nonisolated static let chrome: CGFloat = 44 + 12

    let player: PlayerModel
    let stage: EmbedStage
    /// The height of the window the panel floats in.
    let windowHeight: CGFloat

    #if os(macOS)
        @Environment(\.appearsActive) private var appearsActive
    #endif

    /// How big `embed` is drawn in a window `windowHeight` tall: its own height when there is
    /// room, otherwise as tall as keeps the panel within ``maxShare`` of the window. A video
    /// keeps its aspect ratio as it shrinks; `width` nil means the panel's full width.
    nonisolated static func embedSize(_ embed: Embed, windowHeight: CGFloat) -> (width: CGFloat?, height: CGFloat) {
        let natural = CGFloat(embed.points)
        let room = max(0, windowHeight * maxShare - chrome)
        let height = min(natural, room)
        guard embed.height == .video else { return (nil, height) }
        return (videoWidth * height / natural, height)
    }

    /// Every open window shows the panel, and the one web view plays in the window in use.
    private var prominence: EmbedStage.Prominence {
        #if os(macOS)
            appearsActive ? .focused : .shown
        #else
            .shown
        #endif
    }

    var body: some View {
        VStack(spacing: 0) {
            PlayerBar(player: player, isPanel: true)
            if let embed = player.item?.link?.embed {
                let size = Self.embedSize(embed, windowHeight: windowHeight)
                EmbedView(stage: stage, embed: embed, prominence: prominence)
                    .frame(width: size.width, height: size.height)
                    .frame(maxWidth: size.width == nil ? .infinity : nil)
                    .clipShape(.rect(cornerRadius: 12))
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
            } else if player.item?.kind == .recording {
                HStack(spacing: 8) {
                    RecordingPlayerBody(player: player)
                    AudioRoutePicker(audio: player.audio)
                }
                .padding(.leading, 16)
                .padding(.trailing, 4)
                .padding(.bottom, 8)
            }
        }
    }
}

/// The iPhone's full player: a link's provider player and the link out to the provider, or a
/// recording's scrubber and transport, and Close player. Pulling it down leaves the bar, still
/// playing.
struct PlayerSheet: View {
    let player: PlayerModel
    let stage: EmbedStage

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let link = player.item?.link {
                    Group {
                        if link.embed.height == .video {
                            EmbedView(stage: stage, embed: link.embed)
                                .aspectRatio(16 / 9, contentMode: .fit)
                        } else {
                            EmbedView(stage: stage, embed: link.embed)
                                .frame(height: CGFloat(link.embed.points))
                        }
                    }
                    .clipShape(.rect(cornerRadius: 12))
                    if let url = link.providerURL {
                        Link(destination: url) {
                            Label(PlayerBar.openIn(link.providerName), systemImage: "arrow.up.right")
                        }
                        .buttonStyle(.bordered)
                    }
                } else if player.item?.kind == .recording {
                    RecordingPlayerSheetContent(player: player)
                        .padding(.top, 12)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            // A recording's sheet names it in large type over its controls instead.
            .navigationTitle(player.item?.link == nil ? "" : player.title ?? "")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    PlayerCloseButton(player: player)
                }
            }
        }
        .partHeightSheet()
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }
}

/// Holds a loaded link's player off screen while only the bar shows, so it keeps playing.
struct EmbedParking: ViewModifier {
    let player: PlayerModel
    let stage: EmbedStage

    func body(content: Content) -> some View {
        content.background(alignment: .bottom) {
            if let embed = player.item?.link?.embed {
                EmbedView(stage: stage, embed: embed, prominence: .parked)
                    .frame(width: 1, height: 1)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }
}

extension View {
    /// The player panel floating at the bottom of the window while something is loaded.
    /// `height` reports the room it takes, 0 when nothing is loaded, for the columns under it to
    /// clear, since a split view's columns do not take a safe area inset from outside.
    func playerBar(_ player: PlayerModel, stage: EmbedStage, height: Binding<CGFloat>) -> some View {
        modifier(PlayerBarModifier(player: player, stage: stage, height: height))
    }
}

private struct PlayerBarModifier: ViewModifier {
    let player: PlayerModel
    let stage: EmbedStage
    @Binding var height: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Unmeasured until the first layout, which shows the player at its own size rather than
    /// laying it out at no height.
    @State private var windowHeight: CGFloat = .infinity

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGFloat.self) {
                $0.size.height + $0.safeAreaInsets.top + $0.safeAreaInsets.bottom
            } action: {
                windowHeight = $0
            }
            .overlay(alignment: .bottom) {
                if player.isLoaded {
                    PlayerPanel(player: player, stage: stage, windowHeight: windowHeight)
                        .frame(maxWidth: 560)
                        .modifier(GlassPanel())
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                        .onGeometryChange(for: CGFloat.self) {
                            $0.size.height
                        } action: {
                            height = $0
                        }
                        .onDisappear { height = 0 }
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.default, value: player.isLoaded)
    }
}

/// The player panel's glass, a rounded rectangle around the bar and the player under it. A thick
/// material where glass cannot be drawn.
private struct GlassPanel: ViewModifier {
    @Environment(\.drawsGlass) private var drawsGlass

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 24)
        if drawsGlass {
            content.glassEffect(.regular, in: shape)
        } else {
            content
                .background(.thickMaterial, in: shape)
                .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
        }
    }
}
