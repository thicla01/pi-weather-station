#!/bin/bash
# Pi Weather Station — install.sh
# Full installation script for Raspberry Pi OS (Bullseye, Bookworm, Trixie).

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Pi Weather Station — Installation ==="
echo ""

# --- 0. Node.js ---
NODE_MIN=18
NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)

if ! command -v node &>/dev/null || [ "${NODE_VERSION:-0}" -lt "$NODE_MIN" ]; then
    if command -v node &>/dev/null; then
        echo ">> Node.js $(node --version) detected but version v${NODE_MIN} or later is required."
    else
        echo ">> Node.js is not installed."
    fi
    read -p "   Install Node.js v${NODE_MIN} or later now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        OS_CODENAME=$(lsb_release -cs)
        case "$OS_CODENAME" in
            bullseye) NODE_SETUP="setup_18.x" ;;
            *)        NODE_SETUP="setup_22.x" ;;
        esac
        echo ">> Installing Node.js ($NODE_SETUP) for $OS_CODENAME..."
        curl -fsSL https://deb.nodesource.com/$NODE_SETUP | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo ">> Installation cancelled. Node.js v${NODE_MIN} or later is required."
        exit 1
    fi
else
    echo ">> Node.js detected: $(node --version)"
fi

# --- 1. API key configuration ---
echo ""
if [ -f "$REPO_DIR/settings.json" ]; then
    echo ">> A settings.json file already exists."
    read -p "   Reconfigure it? (y/n) " -n 1 -r
    echo
    CONFIGURE_SETTINGS=$([[ $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
else
    read -p ">> Configure your API keys now? (y/n) " -n 1 -r
    echo
    CONFIGURE_SETTINGS=$([[ $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
fi

if [ "$CONFIGURE_SETTINGS" = "yes" ]; then
    echo ""
    echo "   Press Enter to leave a field empty."
    echo ""

    read -p "   Tomorrow.io API key (weatherApiKey) : " WEATHER_KEY
    read -p "   Mapbox API key (mapApiKey)           : " MAP_KEY
    read -p "   LocationIQ API key (optional)        : " GEO_KEY
    read -p "   Starting latitude                    : " LAT
    read -p "   Starting longitude                   : " LON

    WEATHER_KEY=${WEATHER_KEY:-key}
    MAP_KEY=${MAP_KEY:-key}
    GEO_KEY=${GEO_KEY:-key}

    cat > "$REPO_DIR/settings.json" <<EOF
{
  "weatherApiKey": "$WEATHER_KEY",
  "mapApiKey": "$MAP_KEY",
  "reverseGeoApiKey": "$GEO_KEY",
  "startingLat": "$LAT",
  "startingLon": "$LON"
}
EOF
    echo ">> settings.json created."
else
    if [ ! -f "$REPO_DIR/settings.json" ]; then
        cp "$REPO_DIR/settings.example.json" "$REPO_DIR/settings.json"
        echo ">> settings.json created from settings.example.json. Remember to add your API keys."
    else
        echo ">> settings.json unchanged."
    fi
fi

# --- 2. Node.js dependencies ---
echo ""
echo ">> Installing dependencies..."
cd "$REPO_DIR"
npm install
cd client && npm install && npm run prod && cd ..

# --- 3. Systemd ---
echo ""
echo ">> Configuring systemd service..."
mkdir -p ~/.config/systemd/user
cp "$REPO_DIR/deploy/pi-weather-server.service" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable pi-weather-server
systemctl --user start pi-weather-server
loginctl enable-linger "$USER"
echo ">> Service pi-weather-server enabled and started."

# --- 4. Unified start-server script ---
echo ""
echo ">> Deploying start-server..."
mkdir -p ~/.local/bin
cp "$REPO_DIR/deploy/start-server" ~/.local/bin/start-server
chmod +x ~/.local/bin/start-server
echo ">> ~/.local/bin/start-server installed."

# --- 5. Autostart based on display server ---
echo ""
echo ">> Detecting display server..."
DISPLAY_SERVER=$(ps aux | grep -E 'labwc|wayfire|Xorg' | grep -v grep | awk '{print $11}' | xargs -I{} basename {} 2>/dev/null | head -1)

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
            echo -e "\n[autostart]\nstart-server = start-server" >> "$WAYFIRE_INI"
            echo ">> [autostart] section added to ~/.config/wayfire.ini."
        fi
        ;;
    Xorg)
        echo ">> Display server detected: X11/LXDE"
        LXDE_AUTOSTART="$HOME/.config/lxsession/LXDE-pi/autostart"
        mkdir -p "$(dirname "$LXDE_AUTOSTART")"
        if grep -q "start-server" "$LXDE_AUTOSTART" 2>/dev/null; then
            echo ">> $LXDE_AUTOSTART already configured, no changes made."
        else
            echo "@start-server" >> "$LXDE_AUTOSTART"
            echo ">> $LXDE_AUTOSTART updated."
        fi
        ;;
    *)
        echo ">> Display server not detected."
        echo "   Configure autostart manually. See the README for instructions."
        ;;
esac

echo ""
echo "=== Installation complete ==="
echo "Restart your session to launch the application automatically."
