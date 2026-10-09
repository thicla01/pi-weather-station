# Bring your own SSL certificate

Technical reference for replacing the auto-generated self-signed
certificate with one issued by your own authority (Let's Encrypt,
internal corporate CA, or commercial provider).

---

## Short answer

Set `SKIP_CERT_AUTOGEN=true` in the server's environment (see
[Disabling auto-regeneration](#disabling-auto-regeneration)), replace
`server/cert.pem` and `server/key.pem`, set `chmod 600` on the private
key, and restart the service — no code change required. Without the
env var, the server treats your certificate as stale (its CN/SAN don't
match what it generates) and overwrites both files on the next start.
If you don't supply your own `ca-cert.pem`, move the auto-generated one
aside (see [Files to replace](#files-to-replace)).

---

## Certificate architecture (CA + leaf chain)

The server maintains a two-certificate chain in `server/`:

| File | Role | Validity | Serves TLS? |
|---|---|---|---|
| `ca-cert.pem` + `ca-key.pem` | Self-signed root CA. `basicConstraints=CA:TRUE`, `keyUsage=keyCertSign,cRLSign`. This is what users install in their trust store (phone, laptop). | 10 years | No |
| `cert.pem` + `key.pem` | Server leaf, signed by the CA. `basicConstraints=CA:FALSE`, `keyUsage=digitalSignature,keyEncipherment`, `extendedKeyUsage=serverAuth`, SAN covering `localhost` + every LAN IPv4 + hostname (`<host>` and `<host>.local`). | 825 days | Yes (presented in the handshake with the CA concatenated) |

Why two files? Firefox 150 enforces RFC 5280 strictly and rejects a cert with `CA:TRUE` served as a leaf (`MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY`). Splitting root-CA / server-leaf solves that.

The server regenerates only the leaf when network configuration changes (new DHCP IP, second interface), keeping `ca-cert.pem` intact — clients that already installed the CA stay trusted automatically for the new leaf. A hostname change, however, regenerates the CA as well (its CN embeds the hostname), so clients must re-install it.

`GET /api/cert.pem` serves `ca-cert.pem` (the artefact to install in the trust store), not the leaf.

---

## Files to replace

To replace the auto-generated chain with your own certificate (Let's Encrypt, corporate CA, mkcert):

| File | Contents | Format |
|---|---|---|
| `server/cert.pem` | Your server certificate (+ intermediate chain concatenated if needed) | PEM (X.509) |
| `server/key.pem` | Unencrypted private key matching `cert.pem` | PEM (PKCS#1 or PKCS#8) |
| `server/ca-cert.pem` *(optional)* | Your root CA certificate (Let's Encrypt ISRG Root X1, your internal CA, etc.) — this is what `/api/cert.pem` will serve to clients. Skip if `cert.pem` already contains the full chain (e.g. Let's Encrypt's `fullchain.pem`) — but then move the auto-generated `server/ca-cert.pem` and `server/ca-key.pem` aside (rename them, e.g. to `*.bak`): while the old self-signed CA is on disk, it is appended to your served chain and is what `/api/cert.pem` hands out. Without it, `/api/cert.pem` falls back to serving `cert.pem` (a publicly trusted certificate needs no client install anyway). | PEM (X.509) |

You must also set `SKIP_CERT_AUTOGEN=true` in the server's environment
(see [Disabling auto-regeneration](#disabling-auto-regeneration) below) —
otherwise the server's auto-regen logic detects that the certificate
files don't match its expected pattern (CN, SAN, CA-leaf split) and
overwrites them with a fresh self-signed chain on the next restart.
With the env var set, the server uses the files on disk as-is and never
generates anything; no placeholder `ca-key.pem` is needed.

> **PKCS#12 note**: if your certificate ships in **PKCS#12 (`.pfx` / `.p12`)** form, you
> must convert it to PEM first. See the [Format conversion](#format-conversion) section below.

---

## Procedure

On the Pi (or wherever the server runs):

```bash
# 1. Stop the service
systemctl --user stop pi-weather-server

# 2. Copy the new files
cp /path/to/your-cert.pem  ~/pi-weather-station/server/cert.pem
cp /path/to/your-key.pem   ~/pi-weather-station/server/key.pem
# Not supplying your own ca-cert.pem? Move the auto-generated CA aside:
# mv ~/pi-weather-station/server/ca-cert.pem ~/pi-weather-station/server/ca-cert.pem.bak
# mv ~/pi-weather-station/server/ca-key.pem  ~/pi-weather-station/server/ca-key.pem.bak

# 3. Restrict private-key permissions
chmod 600 ~/pi-weather-station/server/key.pem

# 4. Disable auto-regeneration (once — see "Disabling auto-regeneration")
mkdir -p ~/.config/systemd/user/pi-weather-server.service.d
cat > ~/.config/systemd/user/pi-weather-server.service.d/byo-cert.conf <<'EOF'
[Service]
Environment=SKIP_CERT_AUTOGEN=true
EOF
systemctl --user daemon-reload

# 5. Start the service
systemctl --user start pi-weather-server
```

On macOS, stop the agent with
`launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.pi-weather-station.plist`,
replace step 4 with the plist edit described in
[macOS (launchd agent)](#macos-launchd-agent), and start it again with
`launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.pi-weather-station.plist`.
`launchctl kickstart -k "gui/$(id -u)/com.pi-weather-station"` restarts
the server but does not re-read an edited plist — it is enough only for
later certificate renewals, once the `SKIP_CERT_AUTOGEN` key is in place.

---

## Three typical scenarios

| Scenario | Certificate source |
|---|---|
| Public domain + dynamic DNS | **Let's Encrypt** via certbot — schedule a cron job to renew every ~60 days, with a deploy hook that copies the renewed files into `server/` and restarts the service (see [Recommendations by certificate type](#recommendations-by-certificate-type)) |
| Corporate environment | Certificate signed by the **internal CA** (the CA must already be deployed on client machines) |
| Local network without a domain | **mkcert** generates a local CA + cert for `pi.lan` or similar; the CA must be installed on each client machine |

---

## Caveat: certificate auto-regeneration

The server has auto-regeneration logic in `server/index.js` (function
`sslOptions`). At startup it evaluates two conditions independently:

**CA regeneration** (`caNeedsRegen`) — triggered when:
- `ca-cert.pem` or `ca-key.pem` is missing
- The CA subject CN does not match `Pi Weather Station CA - <hostname>` (or `Pi Weather Station CA` without a usable hostname) — machine hostname changed

**Leaf regeneration** (`leafNeedsRegen`) — triggered when:
- `cert.pem` or `key.pem` is missing
- The cert expires in less than 30 days
- The cert SAN no longer covers every current LAN IP (DHCP change, new interface)
- The leaf subject CN does not match `Pi Weather Station - <hostname>` (or `Pi Weather Station` without a usable hostname)
- The cert is in the old pre-V3 format (single self-signed root with `CA:TRUE`)
- The CA was just regenerated (the leaf must then be re-signed)

When only the leaf condition fires, the server regenerates the leaf using the existing CA — clients that already trust the CA see no warning.

> ⚠ **Important** — without `SKIP_CERT_AUTOGEN=true`, a custom
> certificate is overwritten on the very first restart, not only at
> expiry: its CN (and usually its SAN) won't match what the server
> generates, so the checks above fire and the files on disk are replaced
> by a fresh self-signed chain. With the flag set, the server never
> regenerates anything — an expired certificate keeps being served
> as-is until you renew it and restart, so renewal is entirely up to you.

### Recommendations by certificate type

| Certificate type | Recommendation |
|---|---|
| **Let's Encrypt (90 days)** | certbot renews automatically before expiration, but only under `/etc/letsencrypt` — add a `--deploy-hook` that copies `fullchain.pem` / `privkey.pem` to `server/cert.pem` / `server/key.pem`, `chown`s them to the service user (they are root-owned), `chmod 600`s the key and restarts the service (the server only reads the certificate at startup) |
| **Long-term cert (1–2 years)** | Calendar reminder 30 days before the expiration date |
| **Short-lifetime cert (< 30 days)** | Automation is mandatory — renewal script + service restart |

---

## Disabling auto-regeneration

Set `SKIP_CERT_AUTOGEN=true` in the server's environment. The server
then skips every auto-regen check (CA + leaf) and uses `cert.pem`,
`key.pem`, and `ca-cert.pem` (if present) as-is. If `cert.pem` or
`key.pem` is missing while the flag is set, the server logs an error
and does not fall back to a self-signed chain: it starts in cleartext
HTTP on `127.0.0.1:8080` only (the local kiosk keeps working, remote
access stays down) until the files are provided and the service is
restarted.

### Linux (systemd user service)

Create a drop-in so the change survives `git pull`:

```bash
mkdir -p ~/.config/systemd/user/pi-weather-server.service.d
cat > ~/.config/systemd/user/pi-weather-server.service.d/byo-cert.conf <<'EOF'
[Service]
Environment=SKIP_CERT_AUTOGEN=true
EOF
systemctl --user daemon-reload
systemctl --user restart pi-weather-server
```

### macOS (launchd agent)

Edit `~/Library/LaunchAgents/com.pi-weather-station.plist` and add the
key inside the `<dict>` that follows `<key>EnvironmentVariables</key>`:

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>SKIP_CERT_AUTOGEN</key>
    <string>true</string>
    <!-- existing keys (ALLOW_REMOTE, NODE_ENV, etc.) stay as-is -->
</dict>
```

Then reload:

```bash
launchctl bootout   "gui/$(id -u)" ~/Library/LaunchAgents/com.pi-weather-station.plist 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.pi-weather-station.plist
```

> ⚠ Re-running `bash deploy/install.sh` (which the in-app update dialog
> asks for whenever an installed deploy file differs from its upstream
> copy — as this edited plist always will) rebuilds this plist from the
> repo template — keeping only `NODE_ENV`, `ALLOW_REMOTE` and `DEBUG` —
> and immediately reloads the agent. Without `SKIP_CERT_AUTOGEN`, the
> server then overwrites `cert.pem` / `key.pem` (and `ca-cert.pem`) with
> a fresh self-signed chain on that very start. Back up your certificate
> files before re-running the installer; afterwards restore them, re-add
> the `SKIP_CERT_AUTOGEN` key and reload the agent with `bootout` /
> `bootstrap`. (The Linux `byo-cert.conf` drop-in survives `install.sh`.)

### Verifying

The server logs `SKIP_CERT_AUTOGEN=true — using existing certificate files as-is, no auto-regeneration` on startup when the flag takes effect.

---

## Format conversion

If your certificate ships in a format other than PEM, here are the
common conversions:

### From PKCS#12 (`.pfx` / `.p12`)

```bash
# Extract the private key
openssl pkcs12 -in cert.pfx -nocerts -nodes -out key.pem

# Extract the certificate (and the chain)
openssl pkcs12 -in cert.pfx -nokeys -out cert.pem
```

### From DER (binary)

```bash
openssl x509 -in cert.der -inform DER -out cert.pem -outform PEM
```

### If the private key is encrypted

The Node server does not support encrypted private keys without a code
change. Decrypt it first:

```bash
openssl rsa -in key-encrypted.pem -out key.pem
# (passphrase prompted)
```

---

## Verifying that the right certificate is served

After restarting, validate from any client machine:

```bash
# Inspect the certificate served
openssl s_client -connect <pi-ip>:8443 -servername <hostname> < /dev/null \
  | openssl x509 -noout -issuer -subject -dates

# Test with curl
curl -v https://<pi-ip>:8443/api/is-local
```

The `openssl s_client` command should report the `issuer` matching your
CA (instead of `CN=Pi Weather Station CA - <hostname>` for the
auto-generated chain) and the validity dates you expect.
