#!/bin/bash
# Pi Weather Station — toggle-remote.sh
#
# Toggles ALLOW_REMOTE on/off on the running install. Reads the current state
# from the systemd unit (Linux) or the launchd plist (macOS), asks the user to
# confirm the inverse action, and applies it: edits the env var, regenerates
# the SSL certificate with the LAN IP as a Subject Alternative Name (when
# enabling), reloads the service manager, and restarts the server.
#
# This is the focused equivalent of re-running deploy/install.sh just for the
# remote-access section — useful after the initial install when you want to
# flip the switch without re-walking through every prompt.
#
# Usage:
#   bash deploy/toggle-remote.sh
#
# The script auto-detects which direction to go from the current state.
# Settings writes (POST/PUT/PATCH/DELETE) remain localhost-only regardless
# of this toggle — remote clients are always read-only.

set -e

# --- Locate the repo --------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM="$(uname)"

SERVICE_FILE="$HOME/.config/systemd/user/pi-weather-server.service"
PLIST_FILE="$HOME/Library/LaunchAgents/com.pi-weather-station.plist"

# --- Detect current state ---------------------------------------------------
read_current_state_linux() {
    if [ ! -f "$SERVICE_FILE" ]; then
        echo "ERROR: systemd unit not found at $SERVICE_FILE" >&2
        echo "Run bash deploy/install.sh first to set up the service." >&2
        exit 1
    fi
    if grep -qE '^[[:space:]]*Environment=ALLOW_REMOTE=true' "$SERVICE_FILE"; then
        echo "enabled"
    else
        echo "disabled"
    fi
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
print("enabled" if env.get("ALLOW_REMOTE") == "true" else "disabled")
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
    echo ">> Remote access is currently ENABLED."
    read -p "   Disable remote access? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo ">> No change. Exiting."
        exit 0
    fi
    TARGET="disabled"
else
    echo ">> Remote access is currently DISABLED."
    read -p "   Enable remote access? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo ">> No change. Exiting."
        exit 0
    fi
    TARGET="enabled"
fi

# --- Detect IP and regenerate certificate (only when enabling) --------------
REMOTE_IP=""
if [ "$TARGET" = "enabled" ]; then
    if [ "$PLATFORM" = "Darwin" ]; then
        DETECTED_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
    else
        DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        DETECTED_IP=${DETECTED_IP:-127.0.0.1}
    fi
    echo ""
    read -p "   IP address [$DETECTED_IP]: " CUSTOM_IP
    REMOTE_IP=${CUSTOM_IP:-$DETECTED_IP}

    echo ""
    echo ">> Regenerating SSL certificate for localhost and $REMOTE_IP..."
    openssl req -x509 -newkey rsa:2048 \
        -keyout "$REPO_DIR/server/key.pem" \
        -out "$REPO_DIR/server/cert.pem" \
        -days 825 -nodes \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$REMOTE_IP" 2>/dev/null
    chmod 600 "$REPO_DIR/server/key.pem"
    echo ">> SSL certificate regenerated."
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
    env["ALLOW_REMOTE"] = "true"
else:
    env.pop("ALLOW_REMOTE", None)
data["EnvironmentVariables"] = env
with open(plist_path, "wb") as f:
    plistlib.dump(data, f, fmt=plistlib.FMT_XML)
PYEOF
    echo ">> Reloading launchd agent..."
    launchctl bootout "gui/$(id -u)" "$PLIST_FILE" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"
else
    echo ""
    echo ">> Updating systemd unit..."
    if [ "$TARGET" = "enabled" ]; then
        # Uncomment if commented, or add the line if absent.
        if grep -qE '^[[:space:]]*#[[:space:]]*Environment=ALLOW_REMOTE=true' "$SERVICE_FILE"; then
            sed -i 's/^[[:space:]]*#[[:space:]]*Environment=ALLOW_REMOTE=true/Environment=ALLOW_REMOTE=true/' "$SERVICE_FILE"
        elif ! grep -qE '^[[:space:]]*Environment=ALLOW_REMOTE=true' "$SERVICE_FILE"; then
            # Append at the end of the [Service] section.
            sed -i '/^\[Service\]/a Environment=ALLOW_REMOTE=true' "$SERVICE_FILE"
        fi
    else
        # Comment the line so it stays in the file as a hint for next time.
        sed -i 's/^[[:space:]]*Environment=ALLOW_REMOTE=true/# Environment=ALLOW_REMOTE=true/' "$SERVICE_FILE"
    fi
    echo ">> Reloading systemd and restarting service..."
    systemctl --user daemon-reload
    systemctl --user restart pi-weather-server
fi

# --- Report ------------------------------------------------------------------
echo ""
if [ "$TARGET" = "enabled" ]; then
    echo "==============================================================="
    echo "  Remote access ENABLED"
    echo "==============================================================="
    echo "  URL: https://$REMOTE_IP:8443"
    echo ""
    echo "  Remote clients have read-only access — settings writes"
    echo "  (API keys, coordinates) remain restricted to localhost."
    echo ""
    echo "  *** Note: if your IP changes, the SSL cert will no longer"
    echo "      match. Re-run this script (or install.sh) to refresh it."
    echo "==============================================================="
else
    echo "==============================================================="
    echo "  Remote access DISABLED"
    echo "==============================================================="
    echo "  The server now accepts connections from localhost only."
    echo "  To change settings, use the local console or an SSH tunnel:"
    echo "      ssh -L 8443:localhost:8443 user@<pi-ip>"
    echo "==============================================================="
fi
echo ""
