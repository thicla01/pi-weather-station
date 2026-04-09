#!/bin/bash
# Pi Weather Station — uninstall.sh
# Removes the Pi Weather Station service, scripts, and configurations.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Pi Weather Station — Uninstall ==="
echo ""

# --- 1. Systemd service ---
echo ">> Stopping and disabling systemd service..."
systemctl --user stop pi-weather-server 2>/dev/null && echo "   Service stopped." || echo "   Service was not running."
systemctl --user disable pi-weather-server 2>/dev/null && echo "   Service disabled." || echo "   Service was not enabled."
if [ -f "$HOME/.config/systemd/user/pi-weather-server.service" ]; then
    rm "$HOME/.config/systemd/user/pi-weather-server.service"
    systemctl --user daemon-reload
    echo "   Service file removed."
fi

# --- 2. start-server and start-weather scripts ---
echo ""
echo ">> Removing scripts from ~/.local/bin..."
for SCRIPT in start-server start-weather; do
    if [ -f "$HOME/.local/bin/$SCRIPT" ]; then
        rm "$HOME/.local/bin/$SCRIPT"
        echo "   ~/.local/bin/$SCRIPT removed."
    fi
done

# --- 3. Autostart configuration ---
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

# --- 4. settings.json (optional) ---
echo ""
if [ -f "$REPO_DIR/settings.json" ]; then
    read -p ">> Remove settings.json (contains your API keys)? (y/n) " -n 1 -r
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
    read -p ">> Remove SSL certificates (server/cert.pem, server/key.pem)? (y/n) " -n 1 -r
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
    read -p ">> Remove node_modules directories? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$REPO_DIR/node_modules" "$REPO_DIR/client/node_modules"
        echo "   node_modules removed."
    else
        echo "   node_modules kept."
    fi
fi

# --- 7. Project directory (optional) ---
echo ""
read -p ">> Remove the entire project directory ($REPO_DIR)? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "   Are you sure? This cannot be undone. (y/n) " -n 1 -r
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
