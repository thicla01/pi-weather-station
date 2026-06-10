#!/bin/bash
# Pi Weather Station — toggle-debug.sh
#
# Toggles DEBUG on/off on the running install. Reads the current state from
# the systemd drop-in `override.conf` (Linux) or the launchd plist (macOS),
# asks the user to confirm the inverse action, and applies it: edits the
# env var, reloads the service manager, and restarts the server.
#
# This is the focused equivalent of re-running deploy/install.sh just for
# the debug-panel section — useful after the initial install when you want
# to flip the switch without re-walking through every prompt.
#
# Usage:
#   bash deploy/toggle-debug.sh
#
# When DEBUG=true, the bug-icon button appears in ControlButtons (localhost
# only) and the /api/debug + /api/debug/cpu-temp endpoints become reachable.
# Remote clients never see the debug panel regardless of this toggle —
# debugLocalhostOnly middleware enforces that on the server.

set -e

# --- Locate the repo --------------------------------------------------------
# (no $REPO_DIR needed here — unlike toggle-remote.sh, this script does not
# rewrite anything inside the repo, only the systemd drop-in and the plist.)
PLATFORM="$(uname)"

OVERRIDE_DIR="$HOME/.config/systemd/user/pi-weather-server.service.d"
OVERRIDE_FILE="$OVERRIDE_DIR/override.conf"
PLIST_FILE="$HOME/Library/LaunchAgents/com.pi-weather-station.plist"

# --- Detect current state ---------------------------------------------------
# DEBUG lives in `override.conf` (the same drop-in that holds StandardOutput
# and StandardError redirections). install.sh writes a commented template
# line `# Environment=DEBUG=true` that toggles via sed in/out of the comment.
# We follow the same pattern so override.conf keeps its readable shape.
read_current_state_linux() {
    if [ ! -f "$OVERRIDE_FILE" ]; then
        echo "ERROR: systemd drop-in not found at $OVERRIDE_FILE" >&2
        echo "Run bash deploy/install.sh first to set up the service." >&2
        exit 1
    fi
    if grep -qE '^[[:space:]]*Environment=DEBUG=true' "$OVERRIDE_FILE"; then
        echo "enabled"
        return
    fi
    echo "disabled"
}

read_current_state_macos() {
    if [ ! -f "$PLIST_FILE" ]; then
        echo "ERROR: launchd plist not found at $PLIST_FILE" >&2
        echo "Run bash deploy/install.sh first to set up the agent." >&2
        exit 1
    fi
    python3 - "$PLIST_FILE" << 'PYEOF'
import plistlib, sys
with open(sys.argv[1], "rb") as f:
    data = plistlib.load(f)
env = data.get("EnvironmentVariables", {})
print("enabled" if env.get("DEBUG") == "true" else "disabled")
PYEOF
}

if [ "$PLATFORM" = "Darwin" ]; then
    CURRENT="$(read_current_state_macos)"
else
    CURRENT="$(read_current_state_linux)"
fi

# --- Show state and ask for inverse -----------------------------------------
echo ""
if [ "$CURRENT" = "enabled" ]; then
    echo ">> Debug mode is currently ENABLED."
    read -p "   Disable debug mode? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo ">> No change. Exiting."
        exit 0
    fi
    TARGET="disabled"
else
    echo ">> Debug mode is currently DISABLED."
    read -p "   Enable debug mode? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo ">> No change. Exiting."
        exit 0
    fi
    TARGET="enabled"
fi

# --- Apply the toggle -------------------------------------------------------
if [ "$PLATFORM" = "Darwin" ]; then
    echo ""
    echo ">> Updating launchd plist..."
    python3 - "$PLIST_FILE" "$TARGET" << 'PYEOF'
import plistlib, sys
plist_path, target = sys.argv[1:]
with open(plist_path, "rb") as f:
    data = plistlib.load(f)
env = data.get("EnvironmentVariables", {})
if target == "enabled":
    env["DEBUG"] = "true"
else:
    env.pop("DEBUG", None)
data["EnvironmentVariables"] = env
with open(plist_path, "wb") as f:
    plistlib.dump(data, f, fmt=plistlib.FMT_XML)
PYEOF
    echo ">> Reloading launchd agent..."
    launchctl bootout "gui/$(id -u)" "$PLIST_FILE" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"
else
    echo ""
    echo ">> Updating systemd drop-in..."
    if [ "$TARGET" = "enabled" ]; then
        # Uncomment the template line if present, else append it. Other
        # directives in override.conf (StandardOutput, StandardError) are
        # left untouched.
        if grep -qE '^[[:space:]]*#[[:space:]]*Environment=DEBUG=true' "$OVERRIDE_FILE"; then
            sed -i 's/^[[:space:]]*#[[:space:]]*Environment=DEBUG=true/Environment=DEBUG=true/' "$OVERRIDE_FILE"
        elif ! grep -qE '^[[:space:]]*Environment=DEBUG=true' "$OVERRIDE_FILE"; then
            echo "Environment=DEBUG=true" >> "$OVERRIDE_FILE"
        fi
    else
        # Re-comment the line rather than delete it, so the template stays
        # visible for future toggles and matches what install.sh writes.
        sed -i 's/^[[:space:]]*Environment=DEBUG=true/# Environment=DEBUG=true/' "$OVERRIDE_FILE"
    fi
    echo ">> Reloading systemd and restarting service..."
    systemctl --user daemon-reload
    systemctl --user restart pi-weather-server
fi

# --- Report ------------------------------------------------------------------
echo ""
if [ "$TARGET" = "enabled" ]; then
    echo "==============================================================="
    echo "  Debug mode ENABLED"
    echo "==============================================================="
    echo "  - Bug-icon button now appears in ControlButtons (localhost"
    echo "    only — remote clients never see it)."
    echo "  - /api/debug and /api/debug/cpu-temp endpoints reachable"
    echo "    from localhost; debugLocalhostOnly middleware blocks remote."
    echo "  - Server logs: ~/.local/state/pi-weather-station/server.log on Linux"
    echo "==============================================================="
else
    echo "==============================================================="
    echo "  Debug mode DISABLED"
    echo "==============================================================="
    echo "  The bug icon disappears from ControlButtons. Server logs"
    echo "  on Linux remain redirected to ~/.local/state/pi-weather-station/"
    echo "  server.log via override.conf (legacy installs: /tmp/weather-server.log)"
    echo "==============================================================="
fi
echo ""
