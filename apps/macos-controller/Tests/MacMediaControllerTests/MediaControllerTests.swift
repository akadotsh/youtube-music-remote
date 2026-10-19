import Testing
@testable import MacMediaController

@Test func mapsPlaybackCommands() {
    #expect(MediaControlAdapter.arguments(for: .play) == ["play"])
    #expect(MediaControlAdapter.arguments(for: .pause) == ["pause"])
    #expect(MediaControlAdapter.arguments(for: .next) == ["next-track"])
    #expect(MediaControlAdapter.arguments(for: .previous) == ["previous-track"])
    #expect(MediaControlAdapter.arguments(for: .seek(seconds: 42.5)) == ["seek", "42.5"])
}
