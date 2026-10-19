#!/usr/bin/env bash
set -euo pipefail

ADAPTER_COMMIT="e3ff5021eb0875858bd05f48d2e9ba2e962d1cf6"
ADAPTER_SHA256="adf2564265cbfbed6ee967cd44f70f774a78f681aaa41145c67730cad66f9277"
ADAPTER_URL="https://github.com/ungive/mediaremote-adapter/archive/${ADAPTER_COMMIT}.tar.gz"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CACHE_DIR="${REPOSITORY_ROOT}/target/vendor/mediaremote-adapter"
ARCHIVE_PATH="${CACHE_DIR}/${ADAPTER_COMMIT}.tar.gz"
RUNTIME_DIR="${REPOSITORY_ROOT}/target/mediaremote-adapter"

for command in cmake curl shasum tar; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Missing build dependency: ${command}" >&2
    exit 1
  fi
done

if [[ -f "${RUNTIME_DIR}/.version" ]] \
  && [[ "$(<"${RUNTIME_DIR}/.version")" == "${ADAPTER_COMMIT}" ]] \
  && [[ -f "${RUNTIME_DIR}/mediaremote-adapter.pl" ]] \
  && [[ -d "${RUNTIME_DIR}/MediaRemoteAdapter.framework" ]] \
  && [[ -x "${RUNTIME_DIR}/MediaRemoteAdapterTestClient" ]]; then
  echo "MediaRemote Adapter ${ADAPTER_COMMIT:0:7} is ready."
  exit 0
fi

mkdir -p "${CACHE_DIR}"
if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  curl -L --fail --silent --show-error "${ADAPTER_URL}" -o "${ARCHIVE_PATH}"
fi

ACTUAL_SHA256="$(shasum -a 256 "${ARCHIVE_PATH}" | cut -d ' ' -f 1)"
if [[ "${ACTUAL_SHA256}" != "${ADAPTER_SHA256}" ]]; then
  echo "MediaRemote Adapter checksum mismatch." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/yt-remote-adapter.XXXXXX")"
trap 'rm -rf "${WORK_DIR}"' EXIT
SOURCE_DIR="${WORK_DIR}/source"
BUILD_DIR="${WORK_DIR}/build"
mkdir -p "${SOURCE_DIR}"
tar -xzf "${ARCHIVE_PATH}" -C "${SOURCE_DIR}" --strip-components=1

cmake -S "${SOURCE_DIR}" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}" --config Release \
  --target MediaRemoteAdapter MediaRemoteAdapterTestClient

rm -rf "${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}"
ditto "${BUILD_DIR}/MediaRemoteAdapter.framework" \
  "${RUNTIME_DIR}/MediaRemoteAdapter.framework"
install -m 755 "${SOURCE_DIR}/bin/mediaremote-adapter.pl" "${RUNTIME_DIR}/"
install -m 755 "${BUILD_DIR}/MediaRemoteAdapterTestClient" "${RUNTIME_DIR}/"
install -m 644 "${SOURCE_DIR}/LICENSE" "${RUNTIME_DIR}/LICENSE"
printf '%s' "${ADAPTER_COMMIT}" > "${RUNTIME_DIR}/.version"

echo "MediaRemote Adapter ${ADAPTER_COMMIT:0:7} prepared in ${RUNTIME_DIR}."
