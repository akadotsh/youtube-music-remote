// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "YouTubeMusicRemoteMac",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "MacMediaController", targets: ["MacMediaController"]),
        .executable(name: "yt-remote-macos", targets: ["yt-remote-macos"]),
    ],
    targets: [
        .target(name: "MacMediaController"),
        .executableTarget(name: "yt-remote-macos", dependencies: ["MacMediaController"]),
        .testTarget(name: "MacMediaControllerTests", dependencies: ["MacMediaController"]),
    ]
)
