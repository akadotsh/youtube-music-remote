import Foundation
import MacMediaController

let controller = MediaControlAdapter()

do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard let command = arguments.first else {
        print(usage)
        exit(2)
    }

    switch command {
    case "check":
        try controller.checkCompatibility()
        print("MediaRemote is working on this Mac.")
    case "status":
        guard let state = try controller.currentState() else {
            print("No active media session.")
            break
        }
        printState(state)
    case "play":
        try controller.send(.play)
    case "pause":
        try controller.send(.pause)
    case "next":
        try controller.send(.next)
    case "previous":
        try controller.send(.previous)
    case "seek":
        guard arguments.count == 2, let seconds = Double(arguments[1]), seconds >= 0 else {
            throw ControllerError.commandFailed("seek expects a non-negative number of seconds")
        }
        try controller.send(.seek(seconds: seconds))
    default:
        print(usage)
        exit(2)
    }
} catch {
    FileHandle.standardError.write(Data("Error: \(error.localizedDescription)\n".utf8))
    exit(1)
}

func printState(_ state: MediaState) {
    print("Title:    \(state.title)")
    print("Artist:   \(state.artist ?? "Unknown")")
    print("Album:    \(state.album ?? "Unknown")")
    print("Source:   \(state.source)")
    print("State:    \(state.isPlaying ? "Playing" : "Paused")")
    print("Progress: \(time(state.position)) / \(time(state.duration))")

    if let artwork = state.artwork {
        let path = artworkPath(mimeType: state.artworkMimeType)
        try? artwork.write(to: path, options: .atomic)
        print("Artwork:  \(path.path)")
    } else {
        print("Artwork:  Unavailable")
    }
}

func artworkPath(mimeType: String?) -> URL {
    let extensionName = switch mimeType {
    case "image/png": "png"
    case "image/webp": "webp"
    case "image/gif": "gif"
    default: "jpg"
    }
    return FileManager.default.temporaryDirectory.appendingPathComponent("yt-remote-now-playing.\(extensionName)")
}

func time(_ seconds: TimeInterval?) -> String {
    guard let seconds, seconds.isFinite, seconds >= 0 else { return "--:--" }
    return String(format: "%d:%02d", Int(seconds) / 60, Int(seconds) % 60)
}

let usage = """
Usage: yt-remote-macos <command>

  check              Verify MediaRemote compatibility
  status             Print the active media session
  play               Start playback
  pause              Pause playback
  next               Play the next queue item
  previous           Play the previous queue item
  seek <seconds>      Seek to an absolute position
"""
