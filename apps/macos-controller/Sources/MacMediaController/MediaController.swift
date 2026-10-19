import Foundation

public struct MediaState: Equatable, Sendable {
    public let title: String
    public let artist: String?
    public let album: String?
    public let source: String
    public let isPlaying: Bool
    public let duration: TimeInterval?
    public let position: TimeInterval?
    public let artwork: Data?
    public let artworkMimeType: String?
}

public enum MediaCommand: Equatable, Sendable {
    case play
    case pause
    case next
    case previous
    case seek(seconds: TimeInterval)
}

public protocol MediaControlling {
    func checkCompatibility() throws
    func currentState() throws -> MediaState?
    func send(_ command: MediaCommand) throws
}

public struct MediaControlAdapter: MediaControlling {
    private let executable: String

    public init(executable: String = "media-control") {
        self.executable = executable
    }

    public func checkCompatibility() throws {
        _ = try run(["test"])
    }

    public func currentState() throws -> MediaState? {
        let output = try run(["get", "--now"])
        guard output != "null", let data = output.data(using: .utf8) else { return nil }

        let payload = try JSONDecoder().decode(AdapterPayload.self, from: data)
        return MediaState(
            title: payload.title,
            artist: payload.artist,
            album: payload.album,
            source: payload.parentApplicationBundleIdentifier ?? payload.bundleIdentifier,
            isPlaying: payload.playing,
            duration: payload.duration,
            position: payload.elapsedTimeNow ?? payload.elapsedTime,
            artwork: payload.artworkData.flatMap { Data(base64Encoded: $0) },
            artworkMimeType: payload.artworkMimeType
        )
    }

    public func send(_ command: MediaCommand) throws {
        _ = try run(Self.arguments(for: command))
    }

    static func arguments(for command: MediaCommand) -> [String] {
        switch command {
        case .play: ["play"]
        case .pause: ["pause"]
        case .next: ["next-track"]
        case .previous: ["previous-track"]
        case let .seek(seconds): ["seek", String(seconds)]
        }
    }

    private func run(_ arguments: [String]) throws -> String {
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [executable] + arguments
        process.standardOutput = output
        process.standardError = error

        do {
            try process.run()
        } catch {
            throw ControllerError.unavailable("Install media-control with: brew tap ungive/media-control && brew install media-control")
        }
        process.waitUntilExit()

        let stdout = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let stderr = String(decoding: error.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard process.terminationStatus == 0 else {
            throw ControllerError.commandFailed(stderr.isEmpty ? "media-control exited with status \(process.terminationStatus)" : stderr)
        }
        return stdout
    }
}

public enum ControllerError: LocalizedError {
    case unavailable(String)
    case commandFailed(String)

    public var errorDescription: String? {
        switch self {
        case let .unavailable(message), let .commandFailed(message): message
        }
    }
}

private struct AdapterPayload: Decodable {
    let bundleIdentifier: String
    let parentApplicationBundleIdentifier: String?
    let playing: Bool
    let title: String
    let artist: String?
    let album: String?
    let duration: TimeInterval?
    let elapsedTime: TimeInterval?
    let elapsedTimeNow: TimeInterval?
    let artworkData: String?
    let artworkMimeType: String?
}
