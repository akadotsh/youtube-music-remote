#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${REPOSITORY_ROOT}/target/bundle/macos/YouTube Music Remote.app"
CONTENTS_DIR="${APP_DIR}/Contents"

"${SCRIPT_DIR}/prepare-mediaremote-adapter.sh"
cargo build --manifest-path "${REPOSITORY_ROOT}/Cargo.toml" \
  --release --bin yt-remote-desktop

rm -rf "${APP_DIR}"
mkdir -p "${CONTENTS_DIR}/MacOS" "${CONTENTS_DIR}/Resources"
install -m 755 "${REPOSITORY_ROOT}/target/release/yt-remote-desktop" \
  "${CONTENTS_DIR}/MacOS/youtube-music-remote"
install -m 644 "${REPOSITORY_ROOT}/apps/desktop/macos/Info.plist" \
  "${CONTENTS_DIR}/Info.plist"
ditto "${REPOSITORY_ROOT}/target/mediaremote-adapter" \
  "${CONTENTS_DIR}/Resources/mediaremote-adapter"

codesign --force --deep --sign - "${APP_DIR}"
echo "Desktop app created at ${APP_DIR}"
