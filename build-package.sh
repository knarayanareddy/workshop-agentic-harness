#!/bin/sh
# Builds the standalone harness package for this machine into agentic-harness/agentic-harness-<target>/.
# Usage: ./build-package.sh [extra docker build options]   (TARGETS="..." ./build-package.sh to override)
#
# Docker builds inside a Linux VM on macOS and Windows, so it cannot see the host OS; we detect it here.
set -eu
cd "$(dirname "$0")"

if [ -z "${TARGETS:-}" ]; then
    case "$(uname -s)" in
        Darwin) os=mac ;;
        Linux)  os=linux ;;
        *) echo "Unsupported OS: $(uname -s). On Windows, run build-package.cmd." >&2; exit 1 ;;
    esac
    arch="$(uname -m)"
    # A shell under Rosetta reports x86_64 on Apple Silicon; ask the hardware instead.
    if [ "$os" = mac ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; then arch=arm64; fi
    case "$arch" in
        x86_64|amd64)  arch=x64 ;;
        arm64|aarch64) arch=aarch64 ;;
        *) echo "Unsupported CPU: $arch" >&2; exit 1 ;;
    esac
    TARGETS="$os-$arch"
fi

echo "Building agentic-harness for $TARGETS"
docker build --output . --build-arg TARGETS="$TARGETS" "$@" .
echo "Done: run ./agentic-harness/agentic-harness-$TARGETS/harness"
