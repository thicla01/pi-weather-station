#!/bin/bash
# Pi Weather Station — install.sh
# Full installation script for Raspberry Pi OS (Bullseye, Bookworm, Trixie).

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Pi Weather Station — Installation ==="
echo ""

# --- 0. Node.js ---
NODE_MIN=18
OS_CODENAME=$(lsb_release -cs)
NVM_INSTALL=false

# Load nvm if already installed (so 'node' is available for version check)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)

if ! command -v node &>/dev/null || [ "${NODE_VERSION:-0}" -lt "$NODE_MIN" ]; then
    if command -v node &>/dev/null; then
        echo ">> Node.js $(node --version) detected but version v${NODE_MIN} or later is required."
    else
        echo ">> Node.js is not installed."
    fi

    case "$OS_CODENAME" in
        bullseye)
            # On Bullseye (32-bit ARM), use nvm — NodeSource does not provide
            # Node.js 22 packages for armv7l.
            echo ""
            read -p "   Install Node.js v22 LTS via nvm? (Y/n) " -n 1 -r
            echo
            if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
                echo ">> Installing nvm..."
                curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
                # Source nvm immediately so the rest of this script can use node/npm
                export NVM_DIR="$HOME/.nvm"
                [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
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
            ;;
        *)
            # On Bookworm, Trixie and later — use NodeSource (system-wide install)
            read -p "   Install Node.js v22 LTS via NodeSource? (Y/n) " -n 1 -r
            echo
            if [[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]]; then
                echo ">> Installing Node.js v22 LTS via NodeSource for $OS_CODENAME..."
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                sudo apt-get install -y nodejs
            else
                echo ">> Installation cancelled. Node.js v${NODE_MIN} or later is required."
                exit 1
            fi
            ;;
    esac
else
    echo ">> Node.js detected: $(node --version)"
fi

# Detect nvm usage regardless of whether node was just installed or already present
if [ -s "$HOME/.nvm/nvm.sh" ] && [[ "$(which node 2>/dev/null)" == *"/.nvm/"* ]]; then
    NVM_INSTALL=true
    if command -v nodejs &>/dev/null; then
        echo ""
        echo "   NOTE: A system nodejs package is also present alongside nvm."
        echo "         It will not be used, but you can remove it to avoid confusion:"
        echo "         sudo apt remove nodejs"
    fi
fi

# --- 1. API key configuration ---
echo ""
if [ -f "$REPO_DIR/settings.json" ]; then
    echo ">> A settings.json file already exists."
    read -p "   Reconfigure it? (y/N) " -n 1 -r
    echo
    CONFIGURE_SETTINGS=$([[ $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
else
    read -p ">> Configure your API keys now? (y/N) " -n 1 -r
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

    python3 -c "
import json, sys
data = {
    'weatherApiKey': sys.argv[1],
    'mapApiKey':     sys.argv[2],
    'reverseGeoApiKey': sys.argv[3],
    'startingLat':   sys.argv[4] if sys.argv[4] else None,
    'startingLon':   sys.argv[5] if sys.argv[5] else None,
}
print(json.dumps(data, indent=2))
" "$WEATHER_KEY" "$MAP_KEY" "$GEO_KEY" "$LAT" "$LON" > "$REPO_DIR/settings.json"
    echo ">> settings.json created."
else
    if [ ! -f "$REPO_DIR/settings.json" ]; then
        cp "$REPO_DIR/settings.example.json" "$REPO_DIR/settings.json"
        echo ">> settings.json created from settings.example.json. Remember to add your API keys."
    else
        echo ">> settings.json unchanged."
    fi
fi

# --- 2. Remote network access ---
echo ""
echo ">> Remote network access..."
read -p "   Allow access from other machines on the network? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ALLOW_REMOTE="yes"
    DETECTED_IP=$(hostname -I | awk '{print $1}')
    echo ""
    read -p "   Pi IP address [$DETECTED_IP]: " CUSTOM_IP
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
    echo "   *** WARNING: If your Pi's IP address changes, the SSL certificate"
    echo "       will no longer be valid for remote connections."
    echo "       Re-run install.sh to regenerate it with the new address."
    echo "       To avoid this, consider assigning a static IP to your Pi."
    echo ""
    read -p "   Restrict remote users to read-only? (API keys and settings cannot be modified remotely) (Y/n) " -n 1 -r
    echo
    REMOTE_SECURITY=$([[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")
else
    ALLOW_REMOTE="no"
    REMOTE_SECURITY="no"
fi

# --- 2b. Debug mode ---
echo ""
echo ">> Debug mode..."
read -p "   Enable debug panel? (localhost only, shows cache/quota/logs) (y/N) " -n 1 -r
echo
DEBUG_MODE=$([[ $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")

# --- 2c. Kiosk mode ---
echo ""
echo ">> Kiosk mode..."
read -p "   Launch Chromium automatically in fullscreen on startup? (Y/n) " -n 1 -r
echo
KIOSK_MODE=$([[ -z "$REPLY" || $REPLY =~ ^[Yy]$ ]] && echo "yes" || echo "no")

# --- 3. Node.js dependencies ---
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

# --- 4. Systemd ---
echo ""
echo ">> Configuring systemd service..."
mkdir -p ~/.config/systemd/user
cp "$REPO_DIR/deploy/pi-weather-server.service" ~/.config/systemd/user/
if [ "$ALLOW_REMOTE" = "yes" ]; then
    sed -i 's/# Environment=ALLOW_REMOTE=true/Environment=ALLOW_REMOTE=true/' \
        ~/.config/systemd/user/pi-weather-server.service
fi
if [ "$REMOTE_SECURITY" = "yes" ]; then
    sed -i 's/# Environment=REMOTE_SECURITY=true/Environment=REMOTE_SECURITY=true/' \
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
    # systemd does not source ~/.bashrc (guarded for interactive shells),
    # so nvm must be loaded explicitly via a drop-in override.
    cat > ~/.config/systemd/user/pi-weather-server.service.d/nvm.conf << 'EOF'
[Service]
ExecStart=
ExecStart=/bin/bash -c '. %h/.nvm/nvm.sh && exec npm start'
EOF
    echo ">> nvm sourcing configured for systemd service."
fi
systemctl --user daemon-reload
systemctl --user enable pi-weather-server
systemctl --user start pi-weather-server
loginctl enable-linger "$USER"
echo ">> Service pi-weather-server enabled and started."
echo ">> Server logs available at: tail -f /tmp/weather-server.log"

# --- 4b. Log rotation ---
echo ""
echo ">> Configuring log rotation..."
sudo cp "$REPO_DIR/deploy/logrotate-weather-server" /etc/logrotate.d/weather-server
echo ">> Log rotation configured (daily, 7 days, max 10M, compressed)."

# --- 5. Unified start-server script ---
echo ""
echo ">> Deploying start-server..."
mkdir -p ~/.local/bin
cp "$REPO_DIR/deploy/start-server" ~/.local/bin/start-server
chmod +x ~/.local/bin/start-server
echo ">> ~/.local/bin/start-server installed."

# --- 6. Autostart based on display server ---
if [ "$KIOSK_MODE" = "yes" ]; then
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
else
    echo ""
    echo ">> Kiosk mode skipped — Chromium will not launch automatically."
    echo "   To open the app manually, run: start-server"
    echo "   Or open a browser and navigate to https://localhost:8443"
fi

echo ""
echo "=== Installation complete ==="
echo ""
if [ "$ALLOW_REMOTE" = "yes" ]; then
    echo "   Remote access enabled — https://$REMOTE_IP:8443"
    if [ "$REMOTE_SECURITY" = "yes" ]; then
        echo "   Remote security enabled — remote users have read-only access."
    else
        echo "   Remote security disabled — remote users can modify settings."
    fi
    echo "   NOTE: If your Pi's IP address changes, re-run install.sh to"
    echo "         regenerate the SSL certificate with the new address."
    echo ""
fi
if [ "$DEBUG_MODE" = "yes" ]; then
    echo "   Debug panel enabled — accessible from the Pi only (bug icon in the control bar)."
    echo ""
fi
if [ "$KIOSK_MODE" = "yes" ]; then
    echo "   Kiosk mode enabled — Chromium will launch automatically in fullscreen on startup."
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
