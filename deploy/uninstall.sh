#!/bin/bash
# Pi Weather Station — uninstall.sh
# Removes the Pi Weather Station service, scripts, and configurations.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="$(uname)"

echo "=== Pi Weather Station — Uninstall ==="
echo ""

# --- 1. Service manager ---
if [[ "$PLATFORM" == "Darwin" ]]; then
    # macOS — launchd user agent
    echo ">> Stopping and removing launchd agent..."
    PLIST_DEST="$HOME/Library/LaunchAgents/com.pi-weather-station.plist"
    launchctl bootout "gui/$(id -u)" "$PLIST_DEST" 2>/dev/null \
        && echo "   Agent stopped and unloaded." \
        || echo "   Agent was not loaded."
    if [ -f "$PLIST_DEST" ]; then
        rm "$PLIST_DEST"
        echo "   $PLIST_DEST removed."
    fi

else
    # Linux/Pi — systemd user service
    echo ">> Stopping and disabling systemd service..."
    systemctl --user stop pi-weather-server 2>/dev/null && echo "   Service stopped." || echo "   Service was not running."
    systemctl --user disable pi-weather-server 2>/dev/null && echo "   Service disabled." || echo "   Service was not enabled."
    if [ -f "$HOME/.config/systemd/user/pi-weather-server.service" ]; then
        rm "$HOME/.config/systemd/user/pi-weather-server.service"
        echo "   Service file removed."
    fi
    if [ -d "$HOME/.config/systemd/user/pi-weather-server.service.d" ]; then
        rm -rf "$HOME/.config/systemd/user/pi-weather-server.service.d"
        echo "   Service override directory removed."
    fi

    # Sense HAT display service (optional — only present if Sense HAT was enabled)
    if systemctl --user list-unit-files pi-sensehat.service &>/dev/null; then
        echo ">> Stopping and disabling Sense HAT service..."
        systemctl --user stop pi-sensehat 2>/dev/null && echo "   pi-sensehat stopped." || echo "   pi-sensehat was not running."
        systemctl --user disable pi-sensehat 2>/dev/null && echo "   pi-sensehat disabled." || echo "   pi-sensehat was not enabled."
    fi
    if [ -f "$HOME/.config/systemd/user/pi-sensehat.service" ]; then
        rm "$HOME/.config/systemd/user/pi-sensehat.service"
        echo "   pi-sensehat.service removed."
    fi

    systemctl --user daemon-reload
fi

# --- 2. start-server and start-weather scripts (Linux only) ---
if [[ "$PLATFORM" != "Darwin" ]]; then
    echo ""
    echo ">> Removing scripts from ~/.local/bin..."
    for SCRIPT in start-server start-weather; do
        if [ -f "$HOME/.local/bin/$SCRIPT" ]; then
            rm "$HOME/.local/bin/$SCRIPT"
            echo "   ~/.local/bin/$SCRIPT removed."
        fi
    done
fi

# --- 3. Autostart configuration (Linux only) ---
if [[ "$PLATFORM" != "Darwin" ]]; then
    echo ""
    echo ">> Detecting display server..."
    DISPLAY_SERVER=$(ps aux | grep -E 'labwc|wayfire|Xorg' | grep -v grep | awk '{print $11}' | xargs -I{} basename {} 2>/dev/null | head -1)

    case "$DISPLAY_SERVER" in
        labwc)
            echo ">> Display server detected: labwc"
            if [ -f "$HOME/.config/labwc/autostart" ]; then
                rm "$HOME/.config/labwc/autostart"
                echo "   ~/.config/labwc/autostart removed."
            fi
            ;;
        wayfire)
            echo ">> Display server detected: wayfire"
            WAYFIRE_INI="$HOME/.config/wayfire.ini"
            if grep -qE "start-server|start-weather" "$WAYFIRE_INI" 2>/dev/null; then
                sed -i '/start-server\|start-weather/d' "$WAYFIRE_INI"
                echo "   start-server/start-weather entry removed from ~/.config/wayfire.ini."
            fi
            ;;
        Xorg)
            echo ">> Display server detected: X11/LXDE"
            LXDE_AUTOSTART="$HOME/.config/lxsession/LXDE-pi/autostart"
            if grep -qE "start-server|start-weather" "$LXDE_AUTOSTART" 2>/dev/null; then
                sed -i '/start-server\|start-weather/d' "$LXDE_AUTOSTART"
                echo "   start-server/start-weather entry removed from $LXDE_AUTOSTART."
            fi
            ;;
        *)
            echo ">> Display server not detected. Skipping autostart cleanup."
            ;;
    esac

    # XDG autostart entry (GNOME, KDE Plasma, and any other DE following the
    # freedesktop.org spec). Independent of the display server above — the
    # install script writes here when it detects a desktop environment that
    # isn't labwc/wayfire/LXDE-pi.
    XDG_AUTOSTART="$HOME/.config/autostart/pi-weather-station.desktop"
    if [ -f "$XDG_AUTOSTART" ]; then
        rm "$XDG_AUTOSTART"
        echo "   $XDG_AUTOSTART removed."
    fi
fi

# --- 3b. ~/.config/pi-weather-station/ (browser choice config) ---
if [ -d "$HOME/.config/pi-weather-station" ]; then
    echo ""
    echo ">> Removing per-user kiosk config in ~/.config/pi-weather-station/..."
    rm -rf "$HOME/.config/pi-weather-station"
    echo "   ~/.config/pi-weather-station removed."
fi

# Note: when the Firefox kiosk path was used, start-server created a named
# Firefox profile called "pi-weather-station". It lives in Firefox's
# user-data dir (under ~/.mozilla/firefox/ on deb installs, or inside the
# snap confinement at ~/snap/firefox/.../firefox/ on snap). We don't try to
# remove it automatically — it's harmless leftover and removing it would
# require parsing profiles.ini. To clean up, run `firefox -ProfileManager`
# and delete the "pi-weather-station" profile manually.

# --- 4. settings.json (optional) ---
echo ""
if [ -f "$REPO_DIR/settings.json" ]; then
    read -p ">> Remove settings.json (contains your API keys)? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm "$REPO_DIR/settings.json"
        echo "   settings.json removed."
    else
        echo "   settings.json kept."
    fi
fi

# --- 5. SSL certificates (optional) ---
echo ""
if [ -f "$REPO_DIR/server/cert.pem" ] || [ -f "$REPO_DIR/server/key.pem" ]; then
    read -p ">> Remove SSL certificates (server/cert.pem, server/key.pem)? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -f "$REPO_DIR/server/cert.pem" "$REPO_DIR/server/key.pem"
        echo "   SSL certificates removed."
    else
        echo "   SSL certificates kept."
    fi
fi

# --- 6. node_modules (optional) ---
echo ""
if [ -d "$REPO_DIR/node_modules" ] || [ -d "$REPO_DIR/client/node_modules" ]; then
    read -p ">> Remove node_modules directories? (Y/n) " -n 1 -r
    echo
    if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$REPO_DIR/node_modules" "$REPO_DIR/client/node_modules"
        echo "   node_modules removed."
    else
        echo "   node_modules kept."
    fi
fi

# --- 7. nvm (optional, Bullseye/Linux only) ---
if [[ "$PLATFORM" != "Darwin" ]]; then
    NVM_DIR_EXISTS=false
    FOUND_NVM_DIR=""
    NVM_IN_PROFILES=false
    for _d in "$HOME/.nvm" "${XDG_CONFIG_HOME:-$HOME/.config}/nvm" "$HOME/.config/nvm"; do
        if [ -s "$_d/nvm.sh" ]; then
            NVM_DIR_EXISTS=true
            FOUND_NVM_DIR="$_d"
            break
        fi
    done
    for _PROFILE in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
        grep -q "NVM_DIR" "$_PROFILE" 2>/dev/null && NVM_IN_PROFILES=true && break
    done

    if { [ "$NVM_DIR_EXISTS" = "true" ] || [ "$NVM_IN_PROFILES" = "true" ]; } \
        && [ "$(lsb_release -cs 2>/dev/null)" = "bullseye" ]; then
        echo ""
        if [ "$NVM_DIR_EXISTS" = "true" ]; then
            echo ">> nvm detected (used to install Node.js on Bullseye)."
            echo "   WARNING: nvm manages all Node.js versions for your user account."
            echo "   Removing it will affect any other project that depends on it."
        else
            echo ">> Stale nvm references detected in shell profile files (NVM_DIR)."
            echo "   The nvm directory is already gone but profile entries remain."
        fi
        echo ""
        read -p "   Remove nvm and clean shell profile files? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if [ "$NVM_DIR_EXISTS" = "true" ]; then
                read -p "   Are you sure? This cannot be undone. (y/N) " -n 1 -r
                echo
                [[ ! $REPLY =~ ^[Yy]$ ]] && { echo "   nvm kept."; } || {
                    rm -rf "$FOUND_NVM_DIR"
                    echo "   $FOUND_NVM_DIR removed."
                }
            fi
            for _PROFILE in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
                if [ -f "$_PROFILE" ]; then
                    sed -i '/NVM_DIR/d' "$_PROFILE"
                    sed -i '/nvm\.sh/d' "$_PROFILE"
                    sed -i '/nvm_completion/d' "$_PROFILE"
                    sed -i '/# nvm/Id' "$_PROFILE"
                fi
            done
            echo "   Shell profile files cleaned."
        else
            echo "   nvm kept."
        fi
    fi
fi

# --- 8. Project directory (optional) ---
echo ""
read -p ">> Remove the entire project directory ($REPO_DIR)? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "   Are you sure? This cannot be undone. (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$REPO_DIR"
        echo "   Project directory removed."
        echo ""
        echo "=== Uninstall complete ==="
        exit 0
    else
        echo "   Project directory kept."
    fi
fi

echo ""
echo "=== Uninstall complete ==="
