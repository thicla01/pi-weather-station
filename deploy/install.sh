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
        echo ">> Node.js $(node --version) détecté mais la version minimale requise est v${NODE_MIN}."
    else
        echo ">> Node.js n'est pas installé."
    fi
    read -p "   Voulez-vous installer Node.js v${NODE_MIN} ou supérieur? (o/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        OS_CODENAME=$(lsb_release -cs)
        case "$OS_CODENAME" in
            bullseye) NODE_SETUP="setup_18.x" ;;
            *)        NODE_SETUP="setup_22.x" ;;
        esac
        echo ">> Installation de Node.js ($NODE_SETUP) pour $OS_CODENAME..."
        curl -fsSL https://deb.nodesource.com/$NODE_SETUP | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo ">> Installation annulée. Node.js v${NODE_MIN} ou supérieur est requis pour continuer."
        exit 1
    fi
else
    echo ">> Node.js détecté : $(node --version)"
fi

# --- 1. Dépendances Node.js ---
echo ""
echo ">> Installation des dépendances..."
cd "$REPO_DIR"
npm install
cd client && npm install && npm run prod && cd ..

# --- 2. Systemd ---
echo ""
echo ">> Configuration du service systemd..."
mkdir -p ~/.config/systemd/user
cp "$REPO_DIR/deploy/pi-weather-server.service" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable pi-weather-server
systemctl --user start pi-weather-server
loginctl enable-linger "$USER"
echo ">> Service pi-weather-server activé et démarré."

# --- 3. Script start-server unifié ---
echo ""
echo ">> Déploiement de start-server..."
cp "$REPO_DIR/deploy/start-server" ~/start-server
chmod +x ~/start-server
echo ">> ~/start-server installé."

# --- 4. Autostart selon le display server ---
echo ""
echo ">> Détection du display server..."
DISPLAY_SERVER=$(ps aux | grep -E 'labwc|wayfire|Xorg' | grep -v grep | awk '{print $11}' | xargs -I{} basename {} 2>/dev/null | head -1)

case "$DISPLAY_SERVER" in
    labwc)
        echo ">> Display server détecté : labwc"
        mkdir -p ~/.config/labwc
        cp "$REPO_DIR/deploy/autostart" ~/.config/labwc/autostart
        echo ">> ~/.config/labwc/autostart configuré."
        ;;
    wayfire)
        echo ">> Display server détecté : wayfire"
        WAYFIRE_INI="$HOME/.config/wayfire.ini"
        if grep -q "start-server" "$WAYFIRE_INI" 2>/dev/null; then
            echo ">> ~/.config/wayfire.ini déjà configuré, aucune modification."
        elif grep -q "\[autostart\]" "$WAYFIRE_INI" 2>/dev/null; then
            sed -i '/\[autostart\]/a start-server = ~/start-server' "$WAYFIRE_INI"
            echo ">> ~/.config/wayfire.ini mis à jour."
        else
            echo -e "\n[autostart]\nstart-server = ~/start-server" >> "$WAYFIRE_INI"
            echo ">> Section [autostart] ajoutée dans ~/.config/wayfire.ini."
        fi
        ;;
    Xorg)
        echo ">> Display server détecté : X11/LXDE"
        LXDE_AUTOSTART="$HOME/.config/lxsession/LXDE-pi/autostart"
        mkdir -p "$(dirname "$LXDE_AUTOSTART")"
        if grep -q "start-server" "$LXDE_AUTOSTART" 2>/dev/null; then
            echo ">> $LXDE_AUTOSTART déjà configuré, aucune modification."
        else
            echo "@~/start-server" >> "$LXDE_AUTOSTART"
            echo ">> $LXDE_AUTOSTART mis à jour."
        fi
        ;;
    *)
        echo ">> Display server non détecté."
        echo "   Configurez l'autostart manuellement. Consultez le README pour les instructions."
        ;;
esac

echo ""
echo "=== Installation terminée ==="
echo "Redémarrez votre session pour lancer l'application automatiquement."
