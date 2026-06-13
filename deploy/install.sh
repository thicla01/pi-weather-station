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
#   Phase 4  Server deps (npm ci) + optional client rebuild
#   Phase 5  Service setup (systemd / launchd)
#   Phase 6  Autostart (labwc / wayfire / X11 LXDE / GNOME / KDE)
#   Phase 7  Advanced features (Sense HAT, etc.)
#   Phase 8  Summary

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="$(uname)"

# --- Parse arguments ---
# --rebuild-client forces rebuilding the React bundle from source. Normally
# we use the bundle.min.js committed to git, which is what every Pi receives
# via the in-app updater. Pass this flag if you've modified client source
# locally and need the install to pick up your changes.
REBUILD_CLIENT=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --rebuild-client) REBUILD_CLIENT=true; shift ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

echo "=== Pi Weather Station — Installation ==="
echo ""

# --- Ensure master branch ---
# Catches the common mistake of running install.sh from a stale branch.
# Skipped intentionally on feat/* and fix/* branches so that maintainers
# can test in-development changes without the script silently switching
# them off the branch they meant to install from. (Bash already loads the
# script into memory before running, so the auto-switch wouldn't even
# affect the running script — but it would replace the deploy/ files we
# subsequently `cp` to ~/.local/bin and ~/.config/systemd/user, which is
# the actually-confusing failure mode.)
cd "$REPO_DIR"

# Auto-discard local edits to all auto-generated tracked artifacts before
# any git operation. `npm install` rewrites the lockfiles; a previous
# `--rebuild-client` run regenerates client/dist/*.bundle.min.js and
# friends. Both are recurring causes of `git pull --ff-only` failures
# during upgrade:
#   - k5map case 1 (May 2026, v2.2.5 → v2.12.0): blocked by a stale
#     package-lock.json that an earlier npm install had modified.
#   - k5map case 2 (May 2026, v2.2.5 → v2.13.x with the lockfile fix
#     applied): same trap on client/dist/bundle.min.js, blocked again.
# All of these files are 100 % auto-generated (lockfiles by npm/npm ci,
# dist files by webpack via `npm run prod`); nobody hand-edits them, so
# a silent `git checkout HEAD -- <pathspec>` is a safe defensive reset.
# The next `git pull` writes the upstream versions back, and `npm ci`
# regenerates the lockfiles deterministically. Errors are tolerated
# (file may not exist on a partial clone, or already be clean).
git checkout HEAD -- package-lock.json client/package-lock.json client/dist 2>/dev/null || true

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$CURRENT_BRANCH" in
    master)
        # Already on master — sync with origin so `npm ci` etc. below
        # picks up the latest. Pre-v2.13.0 installs only pulled when
        # switching FROM another branch, leaving "I'm on master and I
        # ran install.sh from an older copy" stuck on stale code.
        echo ">> On master — syncing with origin..."
        git pull --ff-only || {
            echo ">> WARNING: git pull --ff-only failed."
            echo "   Most likely cause: local changes to a tracked file"
            echo "   other than the npm lockfiles. Run \`git status\` to see"
            echo "   which files, then either commit/stash them or revert"
            echo "   with \`git checkout HEAD -- <file>\` and rerun this script."
            exit 1
        }
        echo ""
        ;;
    feat/*|fix/*)
        echo ">> Running from development branch '$CURRENT_BRANCH' — staying put."
        echo "   (master is the recommended branch for normal installs.)"
        echo ""
        ;;
    *)
        echo ">> Switching from '$CURRENT_BRANCH' to 'master'..."
        git checkout master
        git pull --ff-only
        echo ""
        ;;
esac

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

# Download-then-execute for the NodeSource setup script. The previous
# `curl ... | sudo -E bash -` pipeline silently "succeeded" when curl
# failed (`set -e` without pipefail only sees the LAST command's exit
# code, and bash reading an empty stdin exits 0) — the following
# `apt-get install nodejs` then pulled the distro's nodejs (v12 on
# Bullseye, v18 on Bookworm) instead of v22, a silent version drift.
install_node_via_nodesource() {
    local tmp
    tmp=$(mktemp)
    if ! curl -fsSL https://deb.nodesource.com/setup_22.x -o "$tmp"; then
        rm -f "$tmp"
        echo ">> ERROR: could not download the NodeSource setup script."
        echo "   Check network connectivity and re-run this script."
        exit 1
    fi
    sudo -E bash "$tmp"
    rm -f "$tmp"
    sudo apt-get install -y nodejs
}

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
                        install_node_via_nodesource
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
                    install_node_via_nodesource
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

# Re-verify the version after whichever install branch ran. Catches every
# "the install path quietly produced the wrong Node" case (distro package
# pulled instead of NodeSource, nvm alias not applied, ...) before npm ci
# fails 300 lines later with a cryptic engines error.
NODE_NOW="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1 || true)"
if [ -z "$NODE_NOW" ] || [ "$NODE_NOW" -lt "$NODE_MIN" ]; then
    echo ">> ERROR: Node.js v${NODE_MIN}+ is required but '$(node --version 2>/dev/null || echo "none")' is active."
    echo "   The installation above did not produce the expected version — aborting"
    echo "   before dependency installation. Re-run this script once fixed."
    exit 1
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
    if [ -f "$REPO_DIR/settings.json" ]; then
        echo "   Press Enter to KEEP a field's current value."
    else
        echo "   Press Enter to leave a field empty."
    fi
    echo ""

    read -p "   Tomorrow.io API key (weatherApiKey)         : " WEATHER_KEY
    read -p "   Mapbox API key (mapApiKey)                  : " MAP_KEY
    read -p "   LocationIQ API key (optional)               : " GEO_KEY
    read -p "   Anthropic API key (optional)                : " ANTHROPIC_KEY
    # Air-quality sources are both optional. AirNow covers the US only
    # (sign up free at https://docs.airnowapi.org/account/request/);
    # OpenAQ covers the rest of the world as a fallback (sign up free
    # at https://explore.openaq.org/register). Either, both, or neither
    # can be left empty — the air-quality controller silently no-ops
    # for the sources that aren't configured and falls back to the
    # remaining ones (MELCC for Quebec, ECCC AQHI for Canada-wide).
    read -p "   AirNow API key (US air quality, optional)   : " AIRNOW_KEY
    read -p "   OpenAQ API key (global, optional)           : " OPENAQ_KEY
    read -p "   Starting latitude                           : " LAT
    read -p "   Starting longitude                          : " LON

    # Reconfiguration is a MERGE, not a rewrite. The previous version
    # regenerated settings.json from the prompt answers alone: an empty
    # answer reset weatherApiKey/mapApiKey to the "key" placeholder,
    # dropped the optional keys and lat/lon, and erased every block the
    # prompts don't cover (indoorTemperature credentials, the whole
    # `advanced` tree incl. Sense HAT mode/brightness) — a destructive
    # trap on a configured fleet Pi. Now: existing values survive unless
    # the user typed a replacement, unknown blocks pass through verbatim,
    # and the previous file is kept as settings.json.bak.
    if [ -f "$REPO_DIR/settings.json" ]; then
        cp "$REPO_DIR/settings.json" "$REPO_DIR/settings.json.bak"
        chmod 600 "$REPO_DIR/settings.json.bak"
        echo ">> Existing settings backed up to settings.json.bak."
    fi
    # Pass the API keys + lat/lon via the ENVIRONMENT, not argv. A process's
    # argv is world-readable (`ps aux`, /proc/PID/cmdline mode 0444), so secrets
    # on the command line are visible to any local user for the lifetime of the
    # process; /proc/PID/environ is owner-only (0600). Only the non-secret
    # output path stays on argv.
    WS_weatherApiKey="$WEATHER_KEY" WS_mapApiKey="$MAP_KEY" \
    WS_reverseGeoApiKey="$GEO_KEY" WS_anthropicApiKey="$ANTHROPIC_KEY" \
    WS_airNowApiKey="$AIRNOW_KEY" WS_openAqApiKey="$OPENAQ_KEY" \
    WS_startingLat="$LAT" WS_startingLon="$LON" \
    python3 - "$REPO_DIR/settings.json" <<'PYEOF' > "$REPO_DIR/settings.json.tmp"
import json, os, sys
keys = ["weatherApiKey", "mapApiKey", "reverseGeoApiKey", "anthropicApiKey",
        "airNowApiKey", "openAqApiKey", "startingLat", "startingLon"]
answers = {k: os.environ.get("WS_" + k, "") for k in keys}
path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as fh:
        merged = json.load(fh)
except Exception:
    merged = {}
# Only fields the user actually typed overwrite the existing value.
for k, v in answers.items():
    if v:
        merged[k] = v
# Required keys default to the documented placeholder on a fresh file.
for k in ("weatherApiKey", "mapApiKey", "reverseGeoApiKey"):
    merged.setdefault(k, "key")
print(json.dumps(merged, indent=2))
PYEOF
    mv "$REPO_DIR/settings.json.tmp" "$REPO_DIR/settings.json"
    echo ">> settings.json written (existing values preserved unless replaced)."
else
    if [ ! -f "$REPO_DIR/settings.json" ]; then
        cp "$REPO_DIR/settings.example.json" "$REPO_DIR/settings.json"
        echo ">> settings.json created from settings.example.json. Remember to add your API keys."
    else
        echo ">> settings.json unchanged."
    fi
fi

# settings.json holds the API keys (and later the Homebridge credentials).
# The default umask leaves it 0644 (world-readable); restrict to owner-only
# so no other local account can read the secrets. The server re-applies this
# on every start (settingsCtrl.ensureSecurePermissions), but tighten here too
# so the file is never world-readable even before the service first runs.
if [ -f "$REPO_DIR/settings.json" ]; then
    chmod 600 "$REPO_DIR/settings.json"
fi

# --- Remote network access + SSL cert ---
# Re-runs default to the CURRENT state instead of an unconditional "no":
# install.sh is the documented way to add features later (Sense HAT,
# brightness, ...), and the old fixed-default prompt silently disabled
# remote access / debug on a configured Pi when the user pressed Enter
# through this section. Same state-reading approach as toggle-remote.sh.
CURRENT_REMOTE="no"
if [[ "$PLATFORM" == "Darwin" ]]; then
    EXISTING_PLIST="$HOME/Library/LaunchAgents/com.pi-weather-station.plist"
    if [ -f "$EXISTING_PLIST" ] && plutil -extract EnvironmentVariables.ALLOW_REMOTE raw "$EXISTING_PLIST" 2>/dev/null | grep -q "true"; then
        CURRENT_REMOTE="yes"
    fi
else
    # Two locations, like toggle-remote.sh's read_current_state_linux:
    # local.conf drop-in (v2.8.1+) OR the main service file (pre-v2.8.1
    # installs set Environment=ALLOW_REMOTE=true there directly).
    if grep -qs "ALLOW_REMOTE=true" ~/.config/systemd/user/pi-weather-server.service.d/local.conf \
        || grep -qsE '^Environment=ALLOW_REMOTE=true' ~/.config/systemd/user/pi-weather-server.service; then
        CURRENT_REMOTE="yes"
    fi
fi
echo ""
echo ">> Remote network access..."
if [ "$CURRENT_REMOTE" = "yes" ]; then
    read -p "   Allow access from other machines on the network? [currently: enabled] (Y/n) " -n 1 -r
    echo
    REMOTE_ANSWER=$([[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
else
    read -p "   Allow access from other machines on the network? [currently: disabled] (y/N) " -n 1 -r
    echo
    REMOTE_ANSWER=$([[ $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
fi
if [ "$REMOTE_ANSWER" = "yes" ]; then
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
    echo ">> The server will auto-generate its SSL certificate on first start,"
    echo "   covering every active LAN interface (including $REMOTE_IP)."
    echo "   If the Pi's IP changes later, the server detects the SAN mismatch"
    echo "   on restart and re-signs the leaf cert — the root CA is preserved,"
    echo "   so clients that already trust this Pi stay trusted."
else
    ALLOW_REMOTE="no"
fi

# --- Debug mode ---
# Same current-state default as ALLOW_REMOTE above.
CURRENT_DEBUG="no"
if [[ "$PLATFORM" == "Darwin" ]]; then
    if [ -f "${EXISTING_PLIST:-}" ] && plutil -extract EnvironmentVariables.DEBUG raw "$EXISTING_PLIST" 2>/dev/null | grep -q "true"; then
        CURRENT_DEBUG="yes"
    fi
else
    if grep -qs "^Environment=DEBUG=true" ~/.config/systemd/user/pi-weather-server.service.d/override.conf; then
        CURRENT_DEBUG="yes"
    fi
fi
echo ""
echo ">> Debug mode..."
if [ "$CURRENT_DEBUG" = "yes" ]; then
    read -p "   Enable debug panel? (localhost only, shows cache/quota/logs) [currently: enabled] (Y/n) " -n 1 -r
    echo
    DEBUG_MODE=$([[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
else
    read -p "   Enable debug panel? (localhost only, shows cache/quota/logs) [currently: disabled] (y/N) " -n 1 -r
    echo
    DEBUG_MODE=$([[ $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
fi

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

# Kiosk display scale. Small high-density panels (e.g. a 10" 800x1280 DSI
# screen) render the UI tiny at compositor scale 1; start-server auto-detects
# the panel's physical density and enlarges the UI to match the 7" reference.
#   auto  (default) detect from the panel's physical pixel density
#   1.5   pin a specific factor (overrides detection)
#   off   disable scaling entirely
#DISPLAY_SCALE=auto
EOF
    fi
fi

# ============================================================================
# Phase 4 — Dependencies
# ============================================================================
# Vulnerability scanning + auto-patches are handled by Dependabot on GitHub
# (see .github/dependabot.yml). Locally we install strictly from the lockfile
# with `npm ci` to avoid drift that would otherwise block the in-app updater
# on the next run (it pre-flight-rejects any uncommitted change in tracked
# files, including a re-resolved package-lock.json).

echo ""
echo ">> Installing server dependencies (npm ci)..."
cd "$REPO_DIR"
# `npm ci` deletes node_modules wholesale before reinstalling. A mid-flight
# failure (network drop, npm registry outage) under `set -e` used to kill
# the script with node_modules destroyed and no explanation — the running
# server survives in memory, but the next restart/reboot crash-loops
# (Restart=on-failure) into a black kiosk. Fail with a recovery message.
if ! npm ci --no-audit --no-fund; then
    echo ""
    echo ">> ERROR: npm ci failed — node_modules is now INCOMPLETE."
    echo "   The currently-running service (if any) keeps working from memory,"
    echo "   but the next service restart or reboot would crash-loop."
    echo "   Fix the cause (usually network/registry) and re-run either:"
    echo "     npm ci          (just the dependencies)"
    echo "     bash deploy/install.sh   (the full script)"
    exit 1
fi

# The React bundle (client/dist/bundle.min.js) is committed to git, so the
# Pi normally serves the canonical master build without rebuilding. We only
# rebuild if --rebuild-client was passed or if the committed bundle is
# missing (e.g. accidental deletion).
if [[ "$REBUILD_CLIENT" == "false" && ! -f "$REPO_DIR/client/dist/bundle.min.js" ]]; then
    echo ">> client/dist/bundle.min.js missing — rebuilding from source."
    REBUILD_CLIENT=true
fi

if [[ "$REBUILD_CLIENT" == "true" ]]; then
    echo ">> Building client bundle..."
    cd "$REPO_DIR/client"
    npm ci --no-audit --no-fund
    npm run prod
    cd "$REPO_DIR"
else
    echo ">> Using committed client/dist/bundle.min.js (pass --rebuild-client to force a rebuild)."
fi

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

    # No rotation mechanism exists for the launchd log (newsyslog's
    # rename-based rotation doesn't play well with launchd's always-open
    # fd) — guard against unbounded growth at each re-install instead.
    if [ -f "$REPO_DIR/server.log" ] && [ "$(stat -f%z "$REPO_DIR/server.log" 2>/dev/null || echo 0)" -gt $((50 * 1024 * 1024)) ]; then
        : > "$REPO_DIR/server.log"
        echo ">> server.log was over 50 MB — truncated."
    fi

    launchctl bootout "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
    echo ">> launchd agent installed and started."
    echo ">> Server logs: tail -f $REPO_DIR/server.log"
    echo "   (no automatic rotation on macOS — truncate manually with ': > server.log' if needed)"

else
    # Linux/Pi — systemd user service
    echo ">> Configuring systemd service..."
    mkdir -p ~/.config/systemd/user
    cp "$REPO_DIR/deploy/pi-weather-server.service" ~/.config/systemd/user/

    mkdir -p ~/.config/systemd/user/pi-weather-server.service.d
    # ALLOW_REMOTE lives in a drop-in instead of editing the main service
    # file, so future `cp deploy/pi-weather-server.service ~/.config/...`
    # operations (during update or re-install) leave this customization
    # intact — and the in-app updater's `serviceFileChanged` check stops
    # raising the amber warning on every release.
    if [ "$ALLOW_REMOTE" = "yes" ]; then
        cat > ~/.config/systemd/user/pi-weather-server.service.d/local.conf << 'EOF'
[Service]
Environment=ALLOW_REMOTE=true
EOF
    else
        rm -f ~/.config/systemd/user/pi-weather-server.service.d/local.conf
    fi

    # Log destination: a PERSISTENT per-user path (XDG state dir), not /tmp.
    # /tmp is a tmpfs on RPi OS Trixie / Debian 13 — logs lived in RAM and
    # vanished at reboot, which is exactly when they're needed (post-freeze
    # forensics: kiosk freezes → user reboots → the evidence is gone).
    # Installs older than this change keep writing to /tmp/weather-server.log
    # until install.sh is re-run; the debug panel reads both paths.
    LOG_DIR="$HOME/.local/state/pi-weather-station"
    LOG_FILE="$LOG_DIR/server.log"
    mkdir -p "$LOG_DIR"
    cat > ~/.config/systemd/user/pi-weather-server.service.d/override.conf << EOF
[Service]
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE
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
    else
        # Symmetric cleanup (same pattern as local.conf above): a stale
        # nvm.conf from a previous nvm-based install would point ExecStart
        # at a now-deleted nvm.sh and crash-loop the service on reboot.
        rm -f ~/.config/systemd/user/pi-weather-server.service.d/nvm.conf
    fi
    systemctl --user daemon-reload
    systemctl --user enable pi-weather-server
    # restart (not start): on a re-install over a running service, `start`
    # is a no-op and the freshly-pulled code doesn't run until the next
    # reboot — silently leaving the old version live.
    systemctl --user restart pi-weather-server
    loginctl enable-linger "$USER" 2>/dev/null || true
    echo ">> Service pi-weather-server enabled and (re)started."
    echo ">> Server logs available at: tail -f $LOG_FILE"

    # --- Log rotation ---
    # The repo file is a template (__LOG_FILE__/__USER__/__GROUP__): the
    # old static copy hardcoded `su pi pi`, and on any install where the
    # user isn't `pi` (Bookworm/Trixie ask at imaging; Debian/Ubuntu/
    # openSUSE desktops) logrotate rejected the directive and silently
    # skipped the config forever — the log grew unbounded.
    if command -v logrotate >/dev/null 2>&1 && [ -d /etc/logrotate.d ]; then
        echo ""
        echo ">> Configuring log rotation..."
        # Generated next to the log (NOT mktemp): if sudo is refused the
        # pending file must survive a reboot — /tmp wouldn't on Trixie.
        LOGROTATE_PENDING="$LOG_DIR/logrotate-weather-server.pending"
        # `/^[[:space:]]*#/d` drops the template's comment header: it talks
        # about placeholders and "do not copy verbatim", which is confusing
        # in the installed file (and trips naive __ greps on the result).
        sed -e '/^[[:space:]]*#/d' -e '/^$/d' \
            -e "s|__LOG_FILE__|$LOG_FILE|g" \
            -e "s|__USER__|$USER|g" \
            -e "s|__GROUP__|$(id -gn)|g" \
            "$REPO_DIR/deploy/logrotate-weather-server" > "$LOGROTATE_PENDING"
        # Guarded: a declined sudo password under `set -e` used to abort the
        # whole install here, leaving phases 6-8 (autostart, Sense HAT,
        # summary) unexecuted with no explanation.
        if sudo cp "$LOGROTATE_PENDING" /etc/logrotate.d/weather-server; then
            echo ">> Log rotation configured (daily, 10M cap, 7 rotations, compressed)."
            rm -f "$LOGROTATE_PENDING"
        else
            echo ">> WARNING: log rotation NOT configured (sudo refused)."
            echo "   The generated config was left at $LOGROTATE_PENDING — install it later with:"
            echo "     sudo cp $LOGROTATE_PENDING /etc/logrotate.d/weather-server"
        fi
    else
        echo ""
        echo ">> WARNING: logrotate not found — $LOG_FILE will grow unbounded."
        echo "   Install logrotate (sudo apt-get install logrotate) and re-run this script."
    fi

    # --- start-server script ---
    echo ""
    echo ">> Deploying start-server..."
    mkdir -p ~/.local/bin
    cp "$REPO_DIR/deploy/start-server" ~/.local/bin/start-server
    chmod +x ~/.local/bin/start-server
    cp "$REPO_DIR/deploy/detect-display-scale.sh" ~/.local/bin/detect-display-scale.sh
    chmod +x ~/.local/bin/detect-display-scale.sh
    echo ">> ~/.local/bin/start-server installed."

    # Report the auto-detected display scale so the installer can sanity-check
    # it — useful when a panel reports bad/zero EDID dimensions (pin a value via
    # DISPLAY_SCALE in browser.conf then). Informational only: start-server
    # re-runs this at every boot, so the choice self-corrects if the panel is
    # ever swapped.
    if [ "$KIOSK_MODE" = "yes" ]; then
        DETECTED_SCALE=$(~/.local/bin/detect-display-scale.sh 2>/dev/null || true)
        if [ -n "$DETECTED_SCALE" ]; then
            echo ">> Display auto-scale: ${DETECTED_SCALE}x — dense panel detected; the kiosk UI will be enlarged to match the 7\" reference density."
            echo "   Override anytime via DISPLAY_SCALE in ~/.config/pi-weather-station/browser.conf."
        else
            echo ">> Display auto-scale: none needed (panel density ≈ design baseline, or geometry unavailable)."
        fi
    fi

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
                LABWC_AUTOSTART="$HOME/.config/labwc/autostart"
                # Append, never clobber: this file is shared shell-style
                # config — a user's own autostart entries (screen rotation,
                # unclutter, ...) must survive a re-install.
                if grep -qs "start-server" "$LABWC_AUTOSTART"; then
                    echo ">> $LABWC_AUTOSTART already configured, no changes made."
                elif [ -s "$LABWC_AUTOSTART" ]; then
                    cat "$REPO_DIR/deploy/autostart" >> "$LABWC_AUTOSTART"
                    echo ">> start-server appended to existing $LABWC_AUTOSTART."
                else
                    cp "$REPO_DIR/deploy/autostart" "$LABWC_AUTOSTART"
                    echo ">> $LABWC_AUTOSTART configured."
                fi
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

SENSEHAT_MODE="no"
INDOOR_TEMP_MODE="no"
BRIGHTNESS_MODE="no"

echo ""
echo ">> Advanced features (hardware / external integrations, optional)"
read -p "   Configure now? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then

    # --- Sense HAT (LED matrix) — Linux only ---
    if [[ "$PLATFORM" != "Darwin" ]]; then
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
    fi

    # --- Indoor temperature via Homebridge — all platforms ---
    echo ""
    echo "   Indoor temperature — fetched from a Homebridge sensor (Hue, Dyson, ...)"
    echo "   You will need a running Homebridge instance with homebridge-config-ui-x"
    echo "   reachable from this device."
    read -p "   Configure indoor temperature now? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        INDOOR_TEMP_MODE="yes"
        echo ""
        read -p "   Homebridge URL (e.g. http://192.168.1.10:8581)   : " HB_URL
        read -p "   Homebridge username                              : " HB_USER
        read -s -p "   Homebridge password (input hidden)               : " HB_PASS
        echo

        if [ -z "$HB_URL" ] || [ -z "$HB_USER" ] || [ -z "$HB_PASS" ]; then
            echo "   Missing required field — skipping indoor temperature setup."
            INDOOR_TEMP_MODE="no"
            HB_SENSOR=""
        else
            # Query Homebridge for the list of accessories that expose at least
            # one of CurrentTemperature / CurrentRelativeHumidity / AirQuality,
            # group by serviceName (Dyson exposes 3 services under one name),
            # and let the user pick by number. Falls back to a manual prompt
            # when the API is unreachable or returns nothing usable.
            echo ""
            echo "   Querying Homebridge for available sensors..."
            SENSOR_LIST_FILE=$(mktemp)
            WS_HB_URL="$HB_URL" WS_HB_USER="$HB_USER" WS_HB_PASS="$HB_PASS" \
            python3 - "$SENSOR_LIST_FILE" <<'PYEOF'
import os, sys, json, urllib.request, urllib.error, ssl
# Credentials via the environment (owner-only /proc/PID/environ) rather than
# argv (world-readable via `ps`); only the non-secret output path is on argv.
url = os.environ.get("WS_HB_URL", "")
user = os.environ.get("WS_HB_USER", "")
password = os.environ.get("WS_HB_PASS", "")
out_path = sys.argv[1]
sensors = []
err_msg = ""

def _open(req):
    # Opportunistic TLS verification: try a verifying connection first; only if
    # Homebridge presents an unverifiable certificate (commonly self-signed over
    # HTTPS) fall back to an unverified connection with a warning. For http://
    # URLs no TLS is involved. This narrows the install-time MITM window for
    # valid-cert HTTPS setups without breaking the common http / self-signed
    # cases (the previous code disabled verification unconditionally).
    try:
        return urllib.request.urlopen(req, timeout=10)
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
            sys.stderr.write("   WARNING: Homebridge TLS certificate could not be verified — "
                             "continuing without verification.\n")
            unverified = ssl.create_default_context()
            unverified.check_hostname = False
            unverified.verify_mode = ssl.CERT_NONE
            return urllib.request.urlopen(req, timeout=10, context=unverified)
        raise

try:
    login = urllib.request.Request(
        url.rstrip("/") + "/api/auth/login",
        data=json.dumps({"username": user, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with _open(login) as r:
        token = json.loads(r.read()).get("access_token")
    if not token:
        raise RuntimeError("login response had no access_token")
    accs_req = urllib.request.Request(
        url.rstrip("/") + "/api/accessories",
        headers={"Authorization": "Bearer " + token},
    )
    with _open(accs_req) as r:
        accs = json.loads(r.read())
    grouped = {}
    for a in accs or []:
        name = a.get("serviceName")
        if not name:
            continue
        values = a.get("values") or {}
        caps = []
        if "CurrentTemperature" in values:
            caps.append("temp")
        if "CurrentRelativeHumidity" in values:
            caps.append("humidity")
        if "AirQuality" in values:
            caps.append("air-quality")
        if not caps:
            continue
        grouped.setdefault(name, set()).update(caps)
    sensors = sorted(
        [{"name": n, "caps": sorted(c)} for n, c in grouped.items()],
        key=lambda x: x["name"].lower(),
    )
except urllib.error.HTTPError as e:
    err_msg = "HTTP " + str(e.code) + " from Homebridge (check credentials and URL)"
except urllib.error.URLError as e:
    err_msg = "Network error: " + str(e.reason)
except Exception as e:
    err_msg = str(e)
with open(out_path, "w") as f:
    json.dump({"sensors": sensors, "error": err_msg}, f)
PYEOF

            SENSOR_ERR=$(python3 -c "import json; d=json.load(open('$SENSOR_LIST_FILE')); print(d['error'])")
            SENSOR_COUNT=$(python3 -c "import json; d=json.load(open('$SENSOR_LIST_FILE')); print(len(d['sensors']))")

            HB_SENSOR=""
            if [ -n "$SENSOR_ERR" ]; then
                echo "   ⚠  Could not list sensors: $SENSOR_ERR"
                echo "   Falling back to manual entry."
                read -p "   Sensor name (exact serviceName from Homebridge): " HB_SENSOR
            elif [ "$SENSOR_COUNT" -eq 0 ]; then
                echo "   ⚠  No accessories with temperature, humidity, or air-quality were found."
                echo "   Falling back to manual entry."
                read -p "   Sensor name (exact serviceName from Homebridge): " HB_SENSOR
            else
                echo ""
                echo "   Available sensors:"
                python3 -c "
import json
data = json.load(open('$SENSOR_LIST_FILE'))
for i, s in enumerate(data['sensors'], 1):
    caps = ', '.join(s['caps'])
    print('      {}) {} [{}]'.format(i, s['name'], caps))
"
                echo ""
                while true; do
                    read -p "   Pick a sensor (1-$SENSOR_COUNT, or m to type the name): " CHOICE
                    if [[ "$CHOICE" =~ ^[mM]$ ]]; then
                        read -p "   Sensor name: " HB_SENSOR
                        break
                    elif [[ "$CHOICE" =~ ^[0-9]+$ ]] && [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le "$SENSOR_COUNT" ]; then
                        HB_SENSOR=$(python3 -c "import json; print(json.load(open('$SENSOR_LIST_FILE'))['sensors'][$CHOICE - 1]['name'])")
                        echo "   Selected: $HB_SENSOR"
                        break
                    else
                        echo "   Invalid choice — enter a number 1-$SENSOR_COUNT or 'm' for manual entry."
                    fi
                done
            fi

            rm -f "$SENSOR_LIST_FILE"

            if [ -z "$HB_SENSOR" ]; then
                echo "   No sensor selected — skipping indoor temperature setup."
                INDOOR_TEMP_MODE="no"
            fi
        fi

        if [ "$INDOOR_TEMP_MODE" = "yes" ]; then
            # Merge an indoorTemperature block into the existing settings.json
            # without disturbing other top-level keys. Credentials (incl. the
            # Homebridge password) via the environment, not argv — argv is
            # world-readable via `ps`; only the non-secret settings path is on
            # argv. Mirrors the sensor-discovery probe above.
            WS_HB_URL="$HB_URL" WS_HB_USER="$HB_USER" WS_HB_PASS="$HB_PASS" WS_HB_SENSOR="$HB_SENSOR" \
            python3 - "$REPO_DIR/settings.json" <<'PYEOF'
import json, os, sys
path = sys.argv[1]
url = os.environ.get("WS_HB_URL", "")
user = os.environ.get("WS_HB_USER", "")
password = os.environ.get("WS_HB_PASS", "")
sensor = os.environ.get("WS_HB_SENSOR", "")
try:
    with open(path) as f: data = json.load(f)
except Exception:
    data = {}
data["indoorTemperature"] = {
    "enabled": True,
    "homebridgeUrl": url,
    "username": user,
    "password": password,
    "sensorName": sensor,
}
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
            # Re-assert 0600: this write embeds the Homebridge password, and
            # Python's open(path, "w") preserves the existing mode but the
            # file may have been created 0644 earlier in a custom flow.
            chmod 600 "$REPO_DIR/settings.json"
            echo ">> indoorTemperature block written to settings.json."
            echo "   To find the exact sensor name, see docs/indoor-temperature.md"
        fi
    fi

    # --- Display brightness control — Linux only, requires kernel overlay + udev rule ---
    if [[ "$PLATFORM" != "Darwin" ]]; then
        echo ""
        echo "   Display brightness control"
        echo "   Lets the kiosk dim the connected screen via a slider in Settings."
        echo "   Only works on Pis with an officially-supported touchscreen (DSI). HDMI"
        echo "   monitors handle brightness physically — the slider stays hidden there."
        read -p "   Configure brightness control? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            BRIGHTNESS_MODE="yes"
        fi
    fi
fi

# --- Sense HAT install (Linux only, after settings are written) ---
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
    # Also stage the clock service unit. NOT enabled / NOT started — the
    # weather service is the default and stays enabled at boot. The clock
    # service is parked, ready for the in-app toggle in Settings → Advanced
    # → Sense HAT to start it via `systemctl --user start pi-sensehat-clock`.
    # See server/sensehatModeCtrl.js for the runtime switch logic, and
    # tools/horloge.py for the clock daemon itself.
    cp "$REPO_DIR/deploy/pi-sensehat-clock.service" ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable pi-sensehat
    systemctl --user start pi-sensehat
    echo ">> Service pi-sensehat enabled and started."
    echo ">> pi-sensehat-clock.service unit installed (parked — toggled via Settings → Advanced → Sense HAT)."
    echo ">> Sense HAT logs: journalctl --user -u pi-sensehat -f"
fi

# --- Indoor temperature: restart the server so it picks up the new config ---
if [ "$INDOOR_TEMP_MODE" = "yes" ]; then
    echo ""
    echo ">> Restarting pi-weather-server to apply indoor temperature config..."
    if [[ "$PLATFORM" == "Darwin" ]]; then
        launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pi-weather-station.plist" 2>/dev/null || true
        launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.pi-weather-station.plist"
    else
        systemctl --user restart pi-weather-server
    fi
fi

# --- Display brightness setup ---
# Two pieces:
#   1. Ensure /boot/firmware/config.txt has `dtoverlay=rpi-backlight` so the
#      kernel exposes /sys/class/backlight/. Required on Trixie + 7" official
#      touchscreen (and CM5 + DSI), not always required on older Bookworm
#      with the 7" screen, never useful on HDMI monitors.
#   2. Add a udev rule that makes /sys/class/backlight/*/brightness writable
#      by the pi user (default permissions are root-write-only). Without
#      this, the Node server gets EACCES when calling fs.writeFileSync.
if [ "$BRIGHTNESS_MODE" = "yes" ]; then
    echo ""
    echo ">> Configuring display brightness control..."

    BACKLIGHT_AVAILABLE_NOW="no"
    if [ -d /sys/class/backlight ] && [ -n "$(ls -A /sys/class/backlight 2>/dev/null)" ]; then
        BACKLIGHT_AVAILABLE_NOW="yes"
    fi

    # Step 1 — config.txt overlay
    CONFIG_TXT=""
    if [ -f /boot/firmware/config.txt ]; then
        CONFIG_TXT="/boot/firmware/config.txt"
    elif [ -f /boot/config.txt ]; then
        CONFIG_TXT="/boot/config.txt"
    fi
    if [ -n "$CONFIG_TXT" ]; then
        if grep -qE '^[[:space:]]*dtoverlay=rpi-backlight' "$CONFIG_TXT"; then
            echo "   $CONFIG_TXT already has dtoverlay=rpi-backlight ✓"
        else
            echo "   Adding dtoverlay=rpi-backlight to $CONFIG_TXT (with backup)..."
            sudo cp "$CONFIG_TXT" "${CONFIG_TXT}.pi-weather-station.bak"
            echo "" | sudo tee -a "$CONFIG_TXT" >/dev/null
            echo "# pi-weather-station: enable software brightness control" | sudo tee -a "$CONFIG_TXT" >/dev/null
            echo "dtoverlay=rpi-backlight" | sudo tee -a "$CONFIG_TXT" >/dev/null
            echo "   ⚠ Reboot required for the overlay to take effect."
        fi
    else
        echo "   Could not find config.txt at /boot/firmware/ or /boot/ — skipping overlay step."
    fi

    # Step 2 — udev rule for write permission
    UDEV_RULE="/etc/udev/rules.d/52-pi-weather-station-backlight.rules"
    if [ -f "$UDEV_RULE" ]; then
        echo "   udev rule already in place ($UDEV_RULE) ✓"
    else
        echo "   Adding udev rule to make backlight brightness writable by user..."
        echo 'SUBSYSTEM=="backlight", RUN+="/bin/chmod 0664 /sys/class/backlight/%k/brightness"' \
            | sudo tee "$UDEV_RULE" >/dev/null
        echo 'SUBSYSTEM=="backlight", RUN+="/bin/chgrp video /sys/class/backlight/%k/brightness"' \
            | sudo tee -a "$UDEV_RULE" >/dev/null
        sudo udevadm control --reload-rules
        # Trigger now so the existing backlight (if any) becomes writable
        # without waiting for a reboot — only useful when the device is
        # already exposed (i.e., overlay was already in place).
        sudo udevadm trigger --subsystem-match=backlight 2>/dev/null || true
    fi

    # Make sure pi user is in the video group (usually already the case)
    if ! groups "$USER" | grep -qw video; then
        echo "   Adding $USER to the video group..."
        sudo usermod -aG video "$USER"
        echo "   ⚠ Log out and back in (or reboot) for the group change to take effect."
    fi

    if [ "$BACKLIGHT_AVAILABLE_NOW" = "no" ]; then
        echo ""
        echo "   Note: /sys/class/backlight is currently empty. Reboot the Pi"
        echo "   to load the dtoverlay, then the slider will appear in Settings →"
        echo "   Advanced settings → Display."
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
    if [ -n "$DETECTED_SCALE" ]; then
        echo "   Display auto-scale: ${DETECTED_SCALE}x (dense panel — UI enlarged to the 7\" reference)."
    fi
    echo ""
fi
if [ "$BRIGHTNESS_MODE" = "yes" ]; then
    echo "   Display brightness control: configured (Settings → Advanced → Display)"
    if [ "$BACKLIGHT_AVAILABLE_NOW" = "no" ]; then
        echo "     ⚠ Reboot required for the dtoverlay to load and the slider to appear."
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
