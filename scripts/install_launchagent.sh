#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.shuyang.cellar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/cellar"
ENTRY="$REPO_DIR/.venv/bin/cellar-web"

if [[ ! -x "$ENTRY" ]]; then
  echo "Missing executable: $ENTRY" >&2
  echo "Run 'uv sync' in $REPO_DIR first." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
PLIST="$PLIST" LABEL="$LABEL" ENTRY="$ENTRY" REPO_DIR="$REPO_DIR" LOG_DIR="$LOG_DIR" \
HOME="$HOME" python3 -c '
import os
import plistlib
from pathlib import Path
payload = {
    "Label": os.environ["LABEL"],
    "ProgramArguments": [os.environ["ENTRY"]],
    "WorkingDirectory": os.environ["REPO_DIR"],
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 30,
    "ProcessType": "Background",
    "StandardOutPath": str(Path(os.environ["LOG_DIR"]) / "stdout.log"),
    "StandardErrorPath": str(Path(os.environ["LOG_DIR"]) / "stderr.log"),
    "EnvironmentVariables": {
        "HOME": os.environ["HOME"],
        "PATH": os.environ["HOME"] + "/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        "PYTHONUNBUFFERED": "1",
    },
}
for name in ("CELLAR_PORT", "CELLAR_HOST", "CELLAR_DATA_DIR"):
    if os.environ.get(name):
        payload["EnvironmentVariables"][name] = os.environ[name]
with open(os.environ["PLIST"], "wb") as handle:
    plistlib.dump(payload, handle)
'
chmod 600 "$PLIST"
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
echo "Installed and started $LABEL"
echo "Web UI: http://127.0.0.1:${CELLAR_PORT:-8788}"
