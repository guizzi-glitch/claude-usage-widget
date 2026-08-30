#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="asm444.codex-usage"
TARGET_PLUGIN="$HOME/.config/omarchy/plugins/$PLUGIN_ID"
TARGET_BIN="$HOME/.local/bin/codex-usage-collector.py"
TARGET_SYSTEMD="$HOME/.config/systemd/user"

command -v omarchy >/dev/null || { echo "Omarchy is required." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required." >&2; exit 1; }

install -Dm755 "$ROOT_DIR/scripts/codex-usage-collector.py" "$TARGET_BIN"
install -Dm644 "$ROOT_DIR/systemd/codex-usage-collector.service" "$TARGET_SYSTEMD/codex-usage-collector.service"
install -Dm644 "$ROOT_DIR/systemd/codex-usage-collector.timer" "$TARGET_SYSTEMD/codex-usage-collector.timer"
install -Dm644 "$ROOT_DIR/omarchy/manifest.json" "$TARGET_PLUGIN/manifest.json"
install -Dm644 "$ROOT_DIR/omarchy/Panel.qml" "$TARGET_PLUGIN/Panel.qml"
install -Dm644 "$ROOT_DIR/omarchy/UsageData.qml" "$TARGET_PLUGIN/UsageData.qml"

systemctl --user daemon-reload
systemctl --user enable --now codex-usage-collector.timer
"$TARGET_BIN" >/dev/null

omarchy-shell shell rescanPlugins >/dev/null
omarchy bar put "$PLUGIN_ID" --section right

echo "Installed Codex Usage in the right section of the Omarchy bar."
