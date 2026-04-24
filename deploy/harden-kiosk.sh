#!/bin/bash
# Pi Weather Station — harden-kiosk.sh
#
# Opportunistic-threat hardening for a Pi deployed in a semi-public location
# (e.g. a kiosk monitor accessible to guests). Designed for the common case:
#   - Display only, no touchscreen, no permanently attached keyboard/mouse
#   - Ethernet-only, on an IoT VLAN
#   - SSH access for maintenance
#
# The script is idempotent — safe to re-run. Steps that can lock you out of
# the machine (SSH, firewall) ask for confirmation.
#
# What it does:
#   1. Blacklists the usb-storage kernel module (no USB mass storage)
#   2. Masks unused getty TTYs (no Ctrl+Alt+F2..F6 shell)
#   3. Installs usbguard with an allowlist built from currently-connected USB
#   4. Installs ufw with a restrictive outbound policy (DNS/HTTP/HTTPS/NTP out,
#      SSH in from the local subnet only)
#   5. Hardens sshd: key-only auth, no root login
#
# Re-running after plugging a new USB device (e.g. a keyboard for maintenance)
# is expected — it refreshes the usbguard allowlist.

set -euo pipefail

# --- Pre-flight -------------------------------------------------------------

if [[ "$EUID" -ne 0 ]]; then
    echo "This script must be run as root (sudo)."
    exit 1
fi

if [[ "$(uname)" != "Linux" ]]; then
    echo "This script is for Linux (Raspberry Pi OS). Aborting."
    exit 1
fi

confirm() {
    # $1 = prompt
    read -p "$1 (y/N) " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]]
}

echo "=== Pi Weather Station — Kiosk Hardening ==="
echo ""

# --- 1. Blacklist usb-storage -----------------------------------------------

echo ">> [1/5] Blacklisting USB mass storage module..."
BLACKLIST_FILE="/etc/modprobe.d/disable-usb-storage.conf"
if [[ ! -f "$BLACKLIST_FILE" ]] || ! grep -q "^blacklist usb-storage" "$BLACKLIST_FILE"; then
    echo "blacklist usb-storage" > "$BLACKLIST_FILE"
    echo "   $BLACKLIST_FILE written."
    if command -v update-initramfs >/dev/null 2>&1; then
        update-initramfs -u >/dev/null
        echo "   initramfs updated."
    fi
    echo "   (Takes effect at next reboot — module may still be loaded this session)"
else
    echo "   Already blacklisted, skipping."
fi
echo ""

# --- 2. Mask unused TTYs ----------------------------------------------------

echo ">> [2/5] Masking unused virtual terminals (tty2..tty6)..."
for TTY in 2 3 4 5 6; do
    if systemctl is-enabled "getty@tty${TTY}.service" >/dev/null 2>&1; then
        systemctl mask "getty@tty${TTY}.service" >/dev/null
        echo "   getty@tty${TTY} masked."
    fi
done
echo "   tty1 (used by the kiosk session) left untouched."
echo ""

# --- 3. usbguard ------------------------------------------------------------

echo ">> [3/5] Installing and configuring usbguard..."
if ! command -v usbguard >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq usbguard
    echo "   usbguard installed."
else
    echo "   usbguard already installed."
fi

POLICY_FILE="/etc/usbguard/rules.conf"
echo ""
echo "   Currently connected USB devices will be added to the allowlist."
echo "   Make sure ONLY trusted devices are plugged in right now."
echo ""
if confirm "   Generate policy from currently-connected devices?"; then
    # Back up existing policy, if any
    if [[ -s "$POLICY_FILE" ]]; then
        cp "$POLICY_FILE" "${POLICY_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
        echo "   Existing policy backed up."
    fi
    usbguard generate-policy > "$POLICY_FILE"
    chmod 600 "$POLICY_FILE"
    echo "   Policy written to $POLICY_FILE."
    systemctl enable --now usbguard >/dev/null
    systemctl restart usbguard
    echo "   usbguard enabled and started."
else
    echo "   Skipping policy generation. Re-run this script with trusted devices plugged in."
fi
echo ""

# --- 4. ufw (firewall) ------------------------------------------------------

echo ">> [4/5] Configuring outbound-restrictive firewall (ufw)..."
if ! command -v ufw >/dev/null 2>&1; then
    apt-get install -y -qq ufw
    echo "   ufw installed."
fi

echo ""
echo "   This will apply the following rules:"
echo "     - Deny all incoming by default"
echo "     - Deny all outgoing by default"
echo "     - Allow outgoing: DNS (53), HTTP (80), HTTPS (443), NTP (123)"
echo "     - Allow incoming SSH (22) from the local subnet only"
echo "     - Allow incoming on ports 8080 and 8443 (weather station UI)"
echo ""
echo "   WARNING: if you're SSH'd in from outside the local subnet, you will"
echo "   lose your connection. Make sure you're on the same LAN, or add your"
echo "   own rule before enabling."
echo ""
if confirm "   Apply firewall rules and enable ufw?"; then
    # Detect local subnet (first ethernet interface with an IPv4 address)
    LAN_CIDR=$(ip -4 -o addr show scope global | awk '{print $4}' | head -1)
    if [[ -z "$LAN_CIDR" ]]; then
        echo "   Could not detect local subnet. Aborting firewall step."
    else
        echo "   Detected local subnet: $LAN_CIDR"
        ufw --force reset >/dev/null
        ufw default deny incoming >/dev/null
        ufw default deny outgoing >/dev/null
        ufw allow out 53 >/dev/null       # DNS
        ufw allow out 80 >/dev/null       # HTTP
        ufw allow out 443 >/dev/null      # HTTPS
        ufw allow out 123 >/dev/null      # NTP
        ufw allow from "$LAN_CIDR" to any port 22 proto tcp >/dev/null   # SSH from LAN
        ufw allow from "$LAN_CIDR" to any port 8080 proto tcp >/dev/null # weather UI (HTTP)
        ufw allow from "$LAN_CIDR" to any port 8443 proto tcp >/dev/null # weather UI (HTTPS)
        ufw --force enable >/dev/null
        echo "   ufw enabled with restrictive policy."
    fi
else
    echo "   Skipping firewall configuration."
fi
echo ""

# --- 5. SSH hardening -------------------------------------------------------

echo ">> [5/5] Hardening sshd configuration..."
SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_OVERRIDE="/etc/ssh/sshd_config.d/99-harden-kiosk.conf"

echo ""
echo "   This will apply:"
echo "     - PasswordAuthentication no     (key-only)"
echo "     - PermitRootLogin no"
echo "     - ChallengeResponseAuthentication no"
echo ""
echo "   WARNING: if you don't have an SSH key set up, you will be locked out."
echo "   Verify with:   ssh-copy-id -i ~/.ssh/id_ed25519 pi@<this-host>"
echo "   from your workstation BEFORE confirming."
echo ""
if confirm "   Apply SSH hardening?"; then
    mkdir -p "$(dirname "$SSHD_OVERRIDE")"
    cat > "$SSHD_OVERRIDE" <<'EOF'
# Pi Weather Station — kiosk hardening
PasswordAuthentication no
PermitRootLogin no
ChallengeResponseAuthentication no
UsePAM yes
EOF
    chmod 644 "$SSHD_OVERRIDE"
    if sshd -t 2>/dev/null; then
        systemctl reload ssh || systemctl reload sshd
        echo "   sshd reloaded with hardened settings."
    else
        echo "   sshd config test failed — reverting."
        rm -f "$SSHD_OVERRIDE"
    fi
else
    echo "   Skipping SSH hardening."
fi
echo ""

# --- Summary ----------------------------------------------------------------

echo "=== Done ==="
echo ""
echo "Recommended follow-ups:"
echo "  - Reboot to activate the usb-storage blacklist"
echo "  - Verify usbguard:   systemctl status usbguard"
echo "  - Verify ufw:        ufw status verbose"
echo "  - Plug a random USB device into the Pi and confirm it's blocked"
echo ""
echo "To undo any step, inspect the files this script created:"
echo "  /etc/modprobe.d/disable-usb-storage.conf"
echo "  /etc/ssh/sshd_config.d/99-harden-kiosk.conf"
echo "  /etc/usbguard/rules.conf (backup: rules.conf.bak.*)"
echo ""
