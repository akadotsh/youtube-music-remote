$ErrorActionPreference = "Stop"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepositoryRoot
try {
    cargo build --manifest-path Cargo.toml --release --bin yt-remote-desktop
    $BundleDirectory = Join-Path $RepositoryRoot "target/bundle/windows"
    New-Item -ItemType Directory -Force -Path $BundleDirectory | Out-Null
    Copy-Item "target/release/yt-remote-desktop.exe" "$BundleDirectory/YouTube Music Remote.exe" -Force
    Write-Output "Desktop app created at $BundleDirectory/YouTube Music Remote.exe"
}
finally {
    Pop-Location
}
