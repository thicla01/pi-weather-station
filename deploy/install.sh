#!/bin/bash
# Pi Weather Station — install.sh
#
# Installation script for Raspberry Pi OS (Bullseye, Bookworm, Trixie),
# Debian/Ubuntu desktops, openSUSE, and macOS.
#
# Structure:
#   Phase 0  Pre-flight checks (curl, git already in place)
#   Phase 1  Node.js
#   Phase 2  Base configuration (API keys, lat/lon, remote access, debug)
#   Phase 3  Kiosk mode + browser selection (Linux only)
#   Phase 4  npm install + production build
#   Phase 5  Service setup (systemd / launchd)
#   Phase 6  Autostart (labwc / wayfire / X11 LXDE / GNOME / KDE)
#   Phase 7  Advanced features (Sense HAT, etc.)
#   Phase 8  Summary

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="$(uname)"

echo "=== Pi Weather Station — Installation ==="
echo ""

# --- Ensure master branch ---
cd "$REPO_DIR"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "master" ]; then
    echo ">> Switching from '$CURRENT_BRANCH' to 'master'..."
    git checkout master
    git pull
    echo ""
fi

# ============================================================================
# Phase 0 — Pre-flight checks
# ============================================================================

# Make sure required user-space tools are present before anything else tries
# to use them. curl in particular is critical because the Linux Node.js
# install path pipes the NodeSource setup script through it.
preflight_install_apt() {
    local pkg="$1"
    echo "   Missing dependency: $pkg"
    read -p "   Install it via apt? (Y/n) " -n 1 -r
    echo
    if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
        sudo apt-get update -qq
        sudo apt-get install -y "$pkg"
    else
        echo "   Cannot continue without $pkg. Aborting."
        exit 1
    fi
}

preflight_install_zypper() {
    local pkg="$1"
    echo "   Missing dependency: $pkg"
    read -p "   Install it via zypper? (Y/n) " -n 1 -r
    echo
    if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
        sudo zypper --non-interactive install "$pkg"
    else
        echo "   Cannot continue without $pkg. Aborting."
        exit 1
    fi
}

preflight_check_tool() {
    local cmd="$1"
    local pkg="${2:-$cmd}"
    if command -v "$cmd" >/dev/null 2>&1; then return 0; fi
    if [[ "$PLATFORM" == "Darwin" ]]; then
        echo "   Missing dependency: $cmd. Install via Homebrew or your preferred method."
        exit 1
    elif command -v apt-get >/dev/null 2>&1; then
        preflight_install_apt "$pkg"
    elif command -v zypper >/dev/null 2>&1; then
        preflight_install_zypper "$pkg"
    else
        echo "   Missing dependency: $cmd. Unsupported package manager — install manually."
        exit 1
    fi
}

echo ">> Pre-flight checks..."
preflight_check_tool curl
preflight_check_tool git
echo ""

# ============================================================================
# Phase 1 — Node.js
# ============================================================================

NODE_MIN=18
NVM_INSTALL=false

# Load nvm if already installed — check common install locations
# (traditional ~/.nvm or XDG ~/.config/nvm depending on nvm version/env)
_load_nvm() {
    for _d in "$HOME/.nvm" "${XDG_CONFIG_HOME:-$HOME/.config}/nvm" "$HOME/.config/nvm"; do
        if [ -s "$_d/nvm.sh" ]; then
            export NVM_DIR="$_d"
            \. "$NVM_DIR/nvm.sh"
            return 0
        fi
    done
    return 1
}
_load_nvm || true

NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)

if ! command -v node &>/dev/null || [ "${NODE_VERSION:-0}" -lt "$NODE_MIN" ]; then
    if command -v node &>/dev/null; then
        echo ">> Node.js $(node --version) detected but version v${NODE_MIN} or later is required."
    else
        echo ">> Node.js is not installed."
    fi

    if [[ "$PLATFORM" == "Darwin" ]]; then
        # macOS — use Homebrew or nvm
        if command -v brew &>/dev/null; then
            read -p "   Install Node.js via Homebrew? (Y/n) " -n 1 -r
            echo
            if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
                echo ">> Installing Node.js via Homebrew..."
                brew install node
            else
                echo ">> Installation cancelled. Node.js v${NODE_MIN} or later is required."
                exit 1
            fi
        else
            echo "   Homebrew not found. Install Node.js from https://nodejs.org/"
            echo "   or install Homebrew first: https://brew.sh/"
            exit 1
        fi
    elif command -v zypper &>/dev/null; then
        # openSUSE — use the distro repo (Leap 16 ships nodejs22, fine for our NODE_MIN=18)
        read -p "   Install Node.js v22 via zypper? (Y/n) " -n 1 -r
        echo
        if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
            echo ">> Installing Node.js v22 via zypper..."
            sudo zypper --non-interactive install nodejs22 npm22 || sudo zypper --non-interactive install nodejs npm
        else
            echo ">> Installation cancelled. Node.js v${NODE_MIN} or later is required."
            exit 1
        fi
    else
        # Debian/Ubuntu/Pi OS — use NodeSource (or nvm on 32-bit ARM Bullseye)
        OS_CODENAME=$(lsb_release -cs 2>/dev/null || echo unknown)
        ARCH=$(uname -m)

        case "$OS_CODENAME" in
            bullseye)
                if [[ "$ARCH" == "armv7l" || "$ARCH" == "armv6l" ]]; then
                    # Bullseye 32-bit ARM: NodeSource doesn't provide Node.js 22
                    # packages for armv7l — use nvm instead.
                    echo ""
                    read -p "   Install Node.js v22 LTS via nvm? (Y/n) " -n 1 -r
                    echo
                    if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
                        echo ">> Installing nvm..."
                        unset NVM_DIR
                        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
                        _load_nvm || true
                        echo ">> Installing Node.js v22 LTS via nvm..."
                        nvm install 22
                        nvm use 22
                        nvm alias default 22
                        NVM_INSTALL=true
                        echo ">> Node.js $(node --version) installed via nvm."
                    else
                        echo ">> Installation cancelled. Node.js v${NODE_MIN} or later is required."
                        exit 1
                    fi
                else
                    read -p "   Install Node.js v22 LTS via NodeSource? (Y/n) " -n 1 -r
                    echo
                    if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
                        echo ">> Installing Node.js v22 LTS via NodeSource for $OS_CODENAME ($ARCH)..."
                        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                        sudo apt-get install -y nodejs
                    else
                        echo ">> Installation cancelled. Node.js v${NODE_MIN} or later is required."
                        exit 1
                    fi
                fi
                ;;
            *)
                read -p "   Install Node.js v22 LTS via NodeSource? (Y/n) " -n 1 -r
                echo
                if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
                    echo ">> Installing Node.js v22 LTS via NodeSource for $OS_CODENAME ($ARCH)..."
                    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                else
                    echo ">> Installation cancelled. Node.js v${NODE_MIN} or later is required."
                    exit 1
                fi
                ;;
        esac
    fi
else
    echo ">> Node.js detected: $(node --version)"
fi

# Detect nvm usage (Linux only) regardless of whether node was just installed or already present
if [[ "$PLATFORM" != "Darwin" ]]; then
    if [ -n "$NVM_DIR" ] && [ -s "$NVM_DIR/nvm.sh" ] && [[ "$(which node 2>/dev/null)" == *"$NVM_DIR"* ]]; then
        NVM_INSTALL=true
        if command -v nodejs &>/dev/null; then
            echo ""
            echo "   NOTE: A system nodejs package is also present alongside nvm."
            echo "         It will not be used, but you can remove it to avoid confusion:"
            echo "         sudo apt remove nodejs"
        fi
    fi
fi

# ============================================================================
# Phase 2 — Base configuration
# ============================================================================

echo ""
if [ -f "$REPO_DIR/settings.json" ]; then
    echo ">> A settings.json file already exists."
    read -p "   Reconfigure it? (y/N) " -n 1 -r
    echo
    CONFIGURE_SETTINGS=$([[ $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
else
    read -p ">> Configure your API keys now? (Y/n) " -n 1 -r
    echo
    CONFIGURE_SETTINGS=$([[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
fi

if [ "$CONFIGURE_SETTINGS" = "yes" ]; then
    echo ""
    echo "   Press Enter to leave a field empty."
    echo ""

    read -p "   Tomorrow.io API key (weatherApiKey) : " WEATHER_KEY
    read -p "   Mapbox API key (mapApiKey)           : " MAP_KEY
    read -p "   LocationIQ API key (optional)        : " GEO_KEY
    read -p "   Anthropic API key (optional)         : " ANTHROPIC_KEY
    read -p "   Starting latitude                    : " LAT
    read -p "   Starting longitude                   : " LON

    WEATHER_KEY=${WEATHER_KEY:-key}
    MAP_KEY=${MAP_KEY:-key}
    GEO_KEY=${GEO_KEY:-key}

    python3 -c "
import json, sys
data = {
    'weatherApiKey': sys.argv[1],
    'mapApiKey':     sys.argv[2],
    'reverseGeoApiKey': sys.argv[3],
    'anthropicApiKey': sys.argv[4] if sys.argv[4] else None,
    'startingLat':   sys.argv[5] if sys.argv[5] else None,
    'startingLon':   sys.argv[6] if sys.argv[6] else None,
}
data = {k: v for k, v in data.items() if v is not None}
print(json.dumps(data, indent=2))
" "$WEATHER_KEY" "$MAP_KEY" "$GEO_KEY" "$ANTHROPIC_KEY" "$LAT" "$LON" > "$REPO_DIR/settings.json"
    echo ">> settings.json created."
else
    if [ ! -f "$REPO_DIR/settings.json" ]; then
        cp "$REPO_DIR/settings.example.json" "$REPO_DIR/settings.json"
        echo ">> settings.json created from settings.example.json. Remember to add your API keys."
    else
        echo ">> settings.json unchanged."
    fi
fi

# --- Remote network access + SSL cert ---
echo ""
echo ">> Remote network access..."
read -p "   Allow access from other machines on the network? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ALLOW_REMOTE="yes"
    if [[ "$PLATFORM" == "Darwin" ]]; then
        DETECTED_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
    else
        DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        DETECTED_IP=${DETECTED_IP:-127.0.0.1}
    fi
    echo ""
    read -p "   IP address [$DETECTED_IP]: " CUSTOM_IP
    REMOTE_IP=${CUSTOM_IP:-$DETECTED_IP}
    echo ""
    echo ">> Generating SSL certificate for localhost and $REMOTE_IP..."
    openssl req -x509 -newkey rsa:2048 \
        -keyout "$REPO_DIR/server/key.pem" \
        -out "$REPO_DIR/server/cert.pem" \
        -days 825 -nodes \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$REMOTE_IP" 2>/dev/null
    chmod 600 "$REPO_DIR/server/key.pem"
    echo ">> SSL certificate generated."
    echo ""
    echo "   *** WARNING: If your IP address changes, the SSL certificate"
    echo "       will no longer be valid for remote connections."
    echo "       Re-run install.sh to regenerate it with the new address."
    echo ""
else
    ALLOW_REMOTE="no"
fi

# --- Debug mode ---
echo ""
echo ">> Debug mode..."
read -p "   Enable debug panel? (localhost only, shows cache/quota/logs) (y/N) " -n 1 -r
echo
DEBUG_MODE=$([[ $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")

# ============================================================================
# Phase 3 — Kiosk mode + browser selection (Linux only)
# ============================================================================
#
# Detects installed browsers and the system default. Lets the user pick which
# one to use in kiosk mode (default = system default). The choice is saved to
# ~/.config/pi-weather-station/browser.conf, which start-server reads at
# launch time. Two browser families are supported:
#
#   - Chromium-based: chromium, chromium-browser, google-chrome,
#     google-chrome-stable, microsoft-edge, microsoft-edge-stable.
#     All accept the same kiosk flags (`--kiosk URL` etc.).
#   - Firefox: needs `--kiosk URL` and a dedicated profile to remember the
#     self-signed-cert acceptance across launches.
#
# Safari is intentionally not supported: macOS Safari has no CLI kiosk mode.

KIOSK_MODE="no"
KIOSK_BROWSER=""
KIOSK_BROWSER_FAMILY=""

if [[ "$PLATFORM" != "Darwin" ]]; then
    echo ""
    echo ">> Kiosk mode..."
    read -p "   Launch a browser automatically in fullscreen on startup? (Y/n) " -n 1 -r
    echo
    if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
        KIOSK_MODE="yes"
    fi
fi

# Browser family classifier — by executable basename
classify_browser_family() {
    local exe_basename
    exe_basename="$(basename "$1")"
    case "$exe_basename" in
        chromium|chromium-browser|google-chrome|google-chrome-stable|microsoft-edge|microsoft-edge-stable|brave-browser)
            echo "chromium" ;;
        firefox|firefox-esr)
            echo "firefox" ;;
        *)
            echo "" ;;
    esac
}

# Look up the system's default browser via xdg-settings (Linux). Returns the
# resolved executable name (e.g. "firefox") or empty if it can't be found.
detect_default_browser() {
    if ! command -v xdg-settings >/dev/null 2>&1; then return; fi
    local desktop_file
    desktop_file=$(xdg-settings get default-web-browser 2>/dev/null || true)
    [ -z "$desktop_file" ] && return
    local exec_line
    for d in /usr/share/applications "$HOME/.local/share/applications"; do
        if [ -f "$d/$desktop_file" ]; then
            exec_line=$(grep -m1 '^Exec=' "$d/$desktop_file" | cut -d= -f2- | awk '{print $1}')
            [ -n "$exec_line" ] && basename "$exec_line" && return
        fi
    done
}

if [ "$KIOSK_MODE" = "yes" ]; then
    # Build the list of installed browsers (in preferred order)
    KNOWN_BROWSERS=(
        chromium chromium-browser google-chrome google-chrome-stable
        microsoft-edge microsoft-edge-stable firefox firefox-esr
    )
    INSTALLED_BROWSERS=()
    for b in "${KNOWN_BROWSERS[@]}"; do
        if command -v "$b" >/dev/null 2>&1; then
            INSTALLED_BROWSERS+=("$b")
        fi
    done

    DEFAULT_BROWSER=$(detect_default_browser || true)

    if [ ${#INSTALLED_BROWSERS[@]} -eq 0 ]; then
        echo ""
        echo "   No supported browser found (chromium, chrome, edge, firefox)."
        echo "   Kiosk mode requires one of these. Install one and re-run install.sh."
        echo "   Disabling kiosk mode for now."
        KIOSK_MODE="no"
    else
        echo ""
        echo "   Installed browsers:"
        local_default_idx=1
        for i in "${!INSTALLED_BROWSERS[@]}"; do
            n=$((i + 1))
            marker=""
            if [ "${INSTALLED_BROWSERS[$i]}" = "$DEFAULT_BROWSER" ]; then
                marker="  (system default)"
                local_default_idx=$n
            fi
            printf "     %d) %s%s\n" "$n" "${INSTALLED_BROWSERS[$i]}" "$marker"
        done
        echo ""
        read -p "   Choose browser for kiosk mode [${local_default_idx}]: " BROWSER_CHOICE
        BROWSER_CHOICE=${BROWSER_CHOICE:-$local_default_idx}
        if ! [[ "$BROWSER_CHOICE" =~ ^[0-9]+$ ]] || \
            [ "$BROWSER_CHOICE" -lt 1 ] || \
            [ "$BROWSER_CHOICE" -gt ${#INSTALLED_BROWSERS[@]} ]; then
            echo "   Invalid choice. Using ${INSTALLED_BROWSERS[$((local_default_idx - 1))]}."
            BROWSER_CHOICE=$local_default_idx
        fi
        KIOSK_BROWSER="${INSTALLED_BROWSERS[$((BROWSER_CHOICE - 1))]}"
        KIOSK_BROWSER_FAMILY=$(classify_browser_family "$KIOSK_BROWSER")
        echo ">> Selected: $KIOSK_BROWSER ($KIOSK_BROWSER_FAMILY)"

        # Persist the choice for start-server. The file is sourced at launch.
        mkdir -p ~/.config/pi-weather-station
        cat > ~/.config/pi-weather-station/browser.conf <<EOF
# Generated by install.sh — used by ~/.local/bin/start-server.
# Re-run install.sh to change the browser, or edit the values directly.
BROWSER_CMD="$KIOSK_BROWSER"
BROWSER_FAMILY="$KIOSK_BROWSER_FAMILY"
EOF
    fi
fi

# ============================================================================
# Phase 4 — Dependencies
# ============================================================================

AUDIT_LOG="$REPO_DIR/npm-audit.log"
{ echo "Pi Weather Station — npm audit report"; echo "Generated: $(date)"; } > "$AUDIT_LOG"

echo ""
echo ">> Installing dependencies..."
cd "$REPO_DIR"
npm install

echo ">> Running security audit (server)..."
echo "" >> "$AUDIT_LOG"
echo "=== Server — $(date) ===" >> "$AUDIT_LOG"
if npm audit >> "$AUDIT_LOG" 2>&1; then
    echo "   No vulnerabilities found."
else
    echo "   Vulnerabilities found — running npm audit fix..."
    npm audit fix 2>&1 | tee -a "$AUDIT_LOG"
    if npm audit > /dev/null 2>&1; then
        echo "   All vulnerabilities resolved."
    else
        echo "   Some vulnerabilities remain — see npm-audit.log for details."
    fi
fi

cd client && npm install

echo ">> Running security audit (client)..."
echo "" >> "$AUDIT_LOG"
echo "=== Client — $(date) ===" >> "$AUDIT_LOG"
if npm audit >> "$AUDIT_LOG" 2>&1; then
    echo "   No vulnerabilities found."
else
    echo "   Vulnerabilities found — running npm audit fix..."
    npm audit fix 2>&1 | tee -a "$AUDIT_LOG"
    if npm audit > /dev/null 2>&1; then
        echo "   All vulnerabilities resolved."
    else
        echo "   Some vulnerabilities remain — see npm-audit.log for details."
    fi
fi

npm run prod && cd ..

# ============================================================================
# Phase 5 — Service setup
# ============================================================================

echo ""
if [[ "$PLATFORM" == "Darwin" ]]; then
    # macOS — launchd user agent
    echo ">> Configuring launchd agent..."
    PLIST_DEST="$HOME/Library/LaunchAgents/com.pi-weather-station.plist"
    mkdir -p "$HOME/Library/LaunchAgents"

    python3 - "$REPO_DIR" "$PLIST_DEST" "$ALLOW_REMOTE" "$DEBUG_MODE" << 'PYEOF'
import plistlib, sys

repo_dir, plist_dest, allow_remote, debug_mode = sys.argv[1:]

with open(repo_dir + "/deploy/com.pi-weather-station.plist", "rb") as f:
    data = plistlib.load(f)

data["WorkingDirectory"] = repo_dir
data["StandardOutPath"]  = repo_dir + "/server.log"
data["StandardErrorPath"] = repo_dir + "/server.log"

env = data.get("EnvironmentVariables", {})
env["NODE_ENV"] = "production"
if allow_remote == "yes":
    env["ALLOW_REMOTE"] = "true"
if debug_mode == "yes":
    env["DEBUG"] = "true"
data["EnvironmentVariables"] = env

with open(plist_dest, "wb") as f:
    plistlib.dump(data, f, fmt=plistlib.FMT_XML)
PYEOF

    launchctl bootout "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
    echo ">> launchd agent installed and started."
    echo ">> Server logs: tail -f $REPO_DIR/server.log"

else
    # Linux/Pi — systemd user service
    echo ">> Configuring systemd service..."
    mkdir -p ~/.config/systemd/user
    cp "$REPO_DIR/deploy/pi-weather-server.service" ~/.config/systemd/user/
    if [ "$ALLOW_REMOTE" = "yes" ]; then
        sed -i 's/# Environment=ALLOW_REMOTE=true/Environment=ALLOW_REMOTE=true/' \
            ~/.config/systemd/user/pi-weather-server.service
    fi

    mkdir -p ~/.config/systemd/user/pi-weather-server.service.d
    cat > ~/.config/systemd/user/pi-weather-server.service.d/override.conf << 'EOF'
[Service]
StandardOutput=append:/tmp/weather-server.log
StandardError=append:/tmp/weather-server.log
# Environment=DEBUG=true
EOF
    if [ "$DEBUG_MODE" = "yes" ]; then
        sed -i 's/# Environment=DEBUG=true/Environment=DEBUG=true/' \
            ~/.config/systemd/user/pi-weather-server.service.d/override.conf
    fi
    if [ "$NVM_INSTALL" = "true" ]; then
        cat > ~/.config/systemd/user/pi-weather-server.service.d/nvm.conf << EOF
[Service]
ExecStart=
ExecStart=/bin/bash -c '. ${NVM_DIR}/nvm.sh && exec npm start'
EOF
        echo ">> nvm sourcing configured for systemd service (${NVM_DIR})."
    fi
    systemctl --user daemon-reload
    systemctl --user enable pi-weather-server
    systemctl --user start pi-weather-server
    loginctl enable-linger "$USER" 2>/dev/null || true
    echo ">> Service pi-weather-server enabled and started."
    echo ">> Server logs available at: tail -f /tmp/weather-server.log"

    # --- Log rotation ---
    if command -v logrotate >/dev/null 2>&1 && [ -d /etc/logrotate.d ]; then
        echo ""
        echo ">> Configuring log rotation..."
        sudo cp "$REPO_DIR/deploy/logrotate-weather-server" /etc/logrotate.d/weather-server
        echo ">> Log rotation configured (daily, 7 days, max 10M, compressed)."
    fi

    # --- start-server script ---
    echo ""
    echo ">> Deploying start-server..."
    mkdir -p ~/.local/bin
    cp "$REPO_DIR/deploy/start-server" ~/.local/bin/start-server
    chmod +x ~/.local/bin/start-server
    echo ">> ~/.local/bin/start-server installed."

    # ========================================================================
    # Phase 6 — Autostart (kiosk only)
    # ========================================================================
    #
    # Detect the active desktop environment / display server and configure
    # autostart accordingly. Supported: labwc, wayfire, X11 LXDE, GNOME, KDE
    # Plasma. GNOME and KDE both honour the freedesktop.org XDG autostart
    # spec, so a single .desktop file works for both.

    if [ "$KIOSK_MODE" = "yes" ]; then
        echo ""
        echo ">> Configuring autostart..."

        # Detect the active display server (labwc, wayfire, Xorg) and the
        # desktop environment if any. Most modern DEs (GNOME, KDE, Cinnamon,
        # MATE, XFCE...) honour the freedesktop.org XDG autostart spec, so
        # writing a `.desktop` file in ~/.config/autostart/ is the catch-all.
        # Three exceptions need special handling:
        #   - labwc        — uses ~/.config/labwc/autostart (shell-style)
        #   - wayfire      — uses ~/.config/wayfire.ini [autostart] section
        #   - LXDE-pi      — uses ~/.config/lxsession/LXDE-pi/autostart
        DISPLAY_SERVER=$(ps aux | grep -E 'labwc|wayfire|Xorg' | grep -v grep | awk '{print $11}' | xargs -I{} basename {} 2>/dev/null | head -1 || true)

        case "$DISPLAY_SERVER" in
            labwc)
                echo ">> Display server detected: labwc"
                mkdir -p ~/.config/labwc
                cp "$REPO_DIR/deploy/autostart" ~/.config/labwc/autostart
                echo ">> ~/.config/labwc/autostart configured."
                ;;
            wayfire)
                echo ">> Display server detected: wayfire"
                WAYFIRE_INI="$HOME/.config/wayfire.ini"
                if grep -q "start-server" "$WAYFIRE_INI" 2>/dev/null; then
                    echo ">> ~/.config/wayfire.ini already configured, no changes made."
                elif grep -q "\[autostart\]" "$WAYFIRE_INI" 2>/dev/null; then
                    sed -i '/\[autostart\]/a start-server = start-server' "$WAYFIRE_INI"
                    echo ">> ~/.config/wayfire.ini updated."
                else
                    printf "\n[autostart]\nstart-server = start-server\n" >> "$WAYFIRE_INI"
                    echo ">> [autostart] section added to ~/.config/wayfire.ini."
                fi
                ;;
            *)
                # Xorg, Wayland (other compositors), or undetected.
                # Special-case LXDE-pi (Raspberry Pi OS X11 default).
                if [ -d "$HOME/.config/lxsession/LXDE-pi" ] || [ -f "/etc/xdg/lxsession/LXDE-pi/autostart" ]; then
                    echo ">> Desktop environment detected: LXDE-pi"
                    LXDE_AUTOSTART="$HOME/.config/lxsession/LXDE-pi/autostart"
                    mkdir -p "$(dirname "$LXDE_AUTOSTART")"
                    if grep -q "start-server" "$LXDE_AUTOSTART" 2>/dev/null; then
                        echo ">> $LXDE_AUTOSTART already configured, no changes made."
                    else
                        if [ ! -f "$LXDE_AUTOSTART" ] && [ -f "/etc/xdg/lxsession/LXDE-pi/autostart" ]; then
                            cp "/etc/xdg/lxsession/LXDE-pi/autostart" "$LXDE_AUTOSTART"
                        fi
                        echo "@start-server" >> "$LXDE_AUTOSTART"
                        echo ">> $LXDE_AUTOSTART updated."
                    fi
                else
                    # XDG autostart catch-all — works on GNOME, KDE Plasma,
                    # Cinnamon, MATE, XFCE, and anything else following the
                    # freedesktop.org spec. Identify the DE if we can, just
                    # for the user-facing log line.
                    DE_NAME="$XDG_CURRENT_DESKTOP"
                    [ -z "$DE_NAME" ] && DE_NAME="${DESKTOP_SESSION:-unknown}"
                    echo ">> Using XDG autostart (desktop: ${DE_NAME})"
                    AUTOSTART_DIR="$HOME/.config/autostart"
                    AUTOSTART_FILE="$AUTOSTART_DIR/pi-weather-station.desktop"
                    mkdir -p "$AUTOSTART_DIR"
                    cat > "$AUTOSTART_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Pi Weather Station Kiosk
Comment=Launches the weather station in fullscreen at login
Exec=$HOME/.local/bin/start-server
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
                    echo ">> $AUTOSTART_FILE created."
                fi
                ;;
        esac
    else
        echo ""
        echo ">> Kiosk mode skipped — browser will not launch automatically."
        echo "   To open the app manually, run: ~/.local/bin/start-server"
        echo "   Or open a browser and navigate to https://localhost:8443"
    fi
fi

# ============================================================================
# Phase 7 — Advanced features
# ============================================================================
#
# Optional integrations that need more than just an API key — typically
# physical hardware or a structured external configuration. Asked separately
# from the base configuration so first-time installers can skip and come back
# later by re-running install.sh.

ADVANCED_PROMPTED="no"
SENSEHAT_MODE="no"

if [[ "$PLATFORM" != "Darwin" ]]; then
    echo ""
    echo ">> Advanced features (hardware integrations, optional)"
    read -p "   Configure now? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ADVANCED_PROMPTED="yes"

        # --- Sense HAT (LED matrix) ---
        echo ""
        echo "   Sense HAT — animated 8x8 LED weather display"
        read -p "   Is a Sense HAT attached and dedicated to this station? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo ""
            echo "   WARNING: pi-weather-station will take exclusive control of the"
            echo "   Sense HAT LED matrix. Any other program writing to the HAT"
            echo "   (clock display, demos, etc.) must be disabled first to avoid"
            echo "   display conflicts."
            echo ""
            echo "   Tip: check for conflicting services with:"
            echo "     systemctl --user list-units | grep -iE 'sense|hat'"
            echo ""
            read -p "   Install Sense HAT LED weather display? (Y/n) " -n 1 -r
            echo
            SENSEHAT_MODE=$([[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
        fi

        # --- Sense HAT install ---
        if [ "$SENSEHAT_MODE" = "yes" ]; then
            echo ""
            echo ">> Installing Sense HAT display service..."
            if ! python3 -c "import sense_hat" 2>/dev/null; then
                echo "   sense-hat Python package not found — installing..."
                if command -v apt-get >/dev/null 2>&1; then
                    sudo apt-get install -y sense-hat
                else
                    echo "   Cannot auto-install sense-hat on this distribution."
                    echo "   Install it manually before continuing, then re-run install.sh."
                fi
            fi
            cp "$REPO_DIR/deploy/pi-sensehat.service" ~/.config/systemd/user/
            systemctl --user daemon-reload
            systemctl --user enable pi-sensehat
            systemctl --user start pi-sensehat
            echo ">> Service pi-sensehat enabled and started."
            echo ">> Sense HAT logs: journalctl --user -u pi-sensehat -f"
        fi
    fi
fi

# ============================================================================
# Phase 8 — Summary
# ============================================================================

echo ""
echo "=== Installation complete ==="
echo ""
if [ "$ALLOW_REMOTE" = "yes" ]; then
    echo "   Remote access enabled — https://$REMOTE_IP:8443"
    echo "   Remote users have read-only access (settings writes always restricted to localhost)."
    if [[ "$PLATFORM" != "Darwin" ]]; then
        echo "   NOTE: If your Pi's IP address changes, re-run install.sh to"
        echo "         regenerate the SSL certificate with the new address."
    fi
    echo ""
fi
if [ "$DEBUG_MODE" = "yes" ]; then
    echo "   Debug panel enabled — accessible from localhost only (bug icon in the control bar)."
    echo ""
fi
if [ -n "$KIOSK_BROWSER" ]; then
    echo "   Kiosk browser: $KIOSK_BROWSER ($KIOSK_BROWSER_FAMILY family)"
    if [ "$KIOSK_BROWSER_FAMILY" = "firefox" ]; then
        echo "     NOTE: First launch will prompt to accept the self-signed certificate."
        echo "     Click \"Accept the Risk and Continue\" — Firefox will remember the choice."
    fi
    echo ""
fi

if [[ "$PLATFORM" == "Darwin" ]]; then
    echo "   Open https://localhost:8443 in your browser."
    echo "   The server starts automatically at login."
    echo ""
    echo "   Useful commands:"
    echo "     Stop:    launchctl stop com.pi-weather-station"
    echo "     Start:   launchctl start com.pi-weather-station"
    echo "     Logs:    tail -f $REPO_DIR/server.log"
else
    if [ "$KIOSK_MODE" = "yes" ]; then
        echo "   Kiosk mode enabled — browser will launch automatically in fullscreen on startup."
    else
        echo "   Kiosk mode disabled — open https://localhost:8443 manually in a browser."
    fi
    echo ""
    read -p ">> Reboot now to launch the application automatically? (Y/n) " -n 1 -r
    echo
    if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
        sudo reboot
    else
        echo "   Reboot skipped. Run 'sudo reboot' when ready."
    fi
fi
