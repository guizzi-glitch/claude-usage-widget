#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLASMOID_ID="org.kde.plasma.codexusage"
TARGET_BIN="$HOME/.local/bin/codex-usage-collector.py"
TARGET_SYSTEMD="$HOME/.config/systemd/user"

command -v kpackagetool6 >/dev/null || { echo "KDE Plasma 6 (kpackagetool6) is required." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required." >&2; exit 1; }

install -Dm755 "$ROOT_DIR/scripts/codex-usage-collector.py" "$TARGET_BIN"
install -Dm644 "$ROOT_DIR/systemd/codex-usage-collector.service" "$TARGET_SYSTEMD/codex-usage-collector.service"
install -Dm644 "$ROOT_DIR/systemd/codex-usage-collector.timer" "$TARGET_SYSTEMD/codex-usage-collector.timer"

kpackagetool6 --type Plasma/Applet --remove "$PLASMOID_ID" >/dev/null 2>&1 || true
kpackagetool6 --type Plasma/Applet --install "$ROOT_DIR/plasmoid"
if systemctl --user daemon-reload 2>/dev/null && systemctl --user enable --now codex-usage-collector.timer 2>/dev/null; then
    echo "Enabled the one-minute user timer."
else
    echo "Could not enable the user timer; Plasma still refreshes the widget every minute."
fi
"$TARGET_BIN" >/dev/null

echo "Installed Codex Usage Monitor. Add it from Plasma's Add Widgets panel."
