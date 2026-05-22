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
DROPIN_DIR="$HOME/.config/systemd/user/pi-weather-server.service.d"
DROPIN_FILE="$DROPIN_DIR/local.conf"
PLIST_FILE="$HOME/Library/LaunchAgents/com.pi-weather-station.plist"

# --- Detect current state ---------------------------------------------------
# ALLOW_REMOTE lives in `local.conf` (drop-in) on installs from v2.8.1+, but
# pre-v2.8.1 installs may still have the line uncommented inside the main
# service file. Treat both as "enabled" so the toggle UX stays consistent
# across both layouts; the apply step normalizes to the drop-in pattern.
read_current_state_linux() {
    if [ ! -f "$SERVICE_FILE" ]; then
        echo "ERROR: systemd unit not found at $SERVICE_FILE" >&2
        echo "Run bash deploy/install.sh first to set up the service." >&2
        exit 1
    fi
    if [ -f "$DROPIN_FILE" ] \
       && grep -qE '^[[:space:]]*Environment=ALLOW_REMOTE=true' "$DROPIN_FILE"; then
        echo "enabled"
        return
    fi
    if grep -qE '^[[:space:]]*Environment=ALLOW_REMOTE=true' "$SERVICE_FILE"; then
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
    echo ">> The server will detect the new SAN coverage requirement on restart"
    echo "   and re-sign the leaf cert to include $REMOTE_IP. The root CA file"
    echo "   (ca-cert.pem) is preserved, so clients that already installed the"
    echo "   CA stay trusted — no re-trust on phones/laptops required."
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
    echo ">> Updating systemd drop-in..."
    mkdir -p "$DROPIN_DIR"
    if [ "$TARGET" = "enabled" ]; then
        cat > "$DROPIN_FILE" << 'EOF'
[Service]
Environment=ALLOW_REMOTE=true
EOF
    else
        rm -f "$DROPIN_FILE"
    fi
    # Legacy migration: pre-v2.8.1 installs had ALLOW_REMOTE uncommented in
    # the main service file. Re-comment it whenever we see it so the drop-in
    # becomes the single source of truth, and the in-app updater's
    # `serviceFileChanged` warning stops triggering on every release.
    if grep -qE '^Environment=ALLOW_REMOTE=true' "$SERVICE_FILE"; then
        sed -i 's/^Environment=ALLOW_REMOTE=true/# Environment=ALLOW_REMOTE=true/' "$SERVICE_FILE"
        echo ">> Migrated legacy ALLOW_REMOTE line out of $SERVICE_FILE."
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
