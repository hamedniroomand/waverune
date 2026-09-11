#!/usr/bin/env bash
# Install the waverune CLI from GitHub Releases, without Node or Bun.
#   curl -fsSL https://raw.githubusercontent.com/hamedniroomand/waverune/main/install.sh | bash
# Options (environment variables):
#   WAVERUNE_REPO      owner/repo to download from (default: hamedniroomand/waverune)
#   WAVERUNE_VERSION   release tag, e.g. v0.3.0 (default: latest)
#   WAVERUNE_BIN_DIR   install directory (default: ~/.local/bin)
#   WAVERUNE_BASE_URL  download base URL, for mirrors and tests (default: GitHub Releases)
set -euo pipefail

REPO="${WAVERUNE_REPO:-hamedniroomand/waverune}"
VERSION="${WAVERUNE_VERSION:-latest}"
BIN_DIR="${WAVERUNE_BIN_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *)
    echo "error: unsupported OS $(uname -s). On Windows, use install.ps1 (see the README)." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *)
    echo "error: unsupported architecture $(uname -m)" >&2
    exit 1
    ;;
esac

asset="waverune-${os}-${arch}.tar.gz"
if [ -n "${WAVERUNE_BASE_URL:-}" ]; then
  base="${WAVERUNE_BASE_URL%/}"
elif [ "$VERSION" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "downloading ${asset} (${VERSION}) from ${base} (about 30 MB)..."
curl -fL --retry 3 --progress-bar "${base}/${asset}" -o "${tmp}/${asset}"
curl -fsSL --retry 3 "${base}/SHA256SUMS.txt" -o "${tmp}/SHA256SUMS.txt"

expected="$(grep " ${asset}\$" "${tmp}/SHA256SUMS.txt" | awk '{print $1}')"
if command -v sha256sum > /dev/null 2>&1; then
  actual="$(sha256sum "${tmp}/${asset}" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "${tmp}/${asset}" | awk '{print $1}')"
fi
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "error: checksum mismatch for ${asset}; refusing to install" >&2
  exit 1
fi

tar -xzf "${tmp}/${asset}" -C "$tmp" waverune
mkdir -p "$BIN_DIR"
install -m 755 "${tmp}/waverune" "${BIN_DIR}/waverune"
echo "installed ${BIN_DIR}/waverune (version $("${BIN_DIR}/waverune" --version))"

case ":$PATH:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo
    echo "note: ${BIN_DIR} is not on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac

echo
echo "try it:  waverune embed input.wav -o output.wav --id 42 --key secret"
echo "         waverune detect output.wav --key secret"
echo "docs:    https://github.com/${REPO}#readme"
