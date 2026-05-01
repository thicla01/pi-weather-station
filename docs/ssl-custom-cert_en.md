# Bring your own SSL certificate

Technical reference for replacing the auto-generated self-signed
certificate with one issued by your own authority (Let's Encrypt,
internal corporate CA, or commercial provider).

---

## Short answer

Replace `server/cert.pem` and `server/key.pem`, set `chmod 600` on the
private key, and restart the service. The server picks them up as-is on
the next start — no code change required.

---

## Files to replace

| File | Contents | Format |
|---|---|---|
| `server/cert.pem` | Certificate (+ intermediate chain concatenated if needed) | PEM (X.509) |
| `server/key.pem` | Unencrypted private key | PEM (PKCS#1 or PKCS#8) |

> **Note**: if your certificate ships in **PKCS#12 (`.pfx` / `.p12`)** form, you
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

# 3. Restrict private-key permissions
chmod 600 ~/pi-weather-station/server/key.pem

# 4. Restart the service
systemctl --user start pi-weather-server
```

On macOS, replace the `systemctl --user` commands with
`launchctl kickstart -k "gui/$(id -u)/com.pi-weather-station"`.

---

## Three typical scenarios

| Scenario | Certificate source |
|---|---|
| Public domain + dynamic DNS | **Let's Encrypt** via certbot — schedule a cron job to renew every ~60 days |
| Corporate environment | Certificate signed by the **internal CA** (the CA must already be deployed on client machines) |
| Local network without a domain | **mkcert** generates a local CA + cert for `pi.lan` or similar; the CA must be installed on each client machine |

---

## Caveat: certificate auto-regeneration

The server has auto-regeneration logic in `server/index.js` around line
95: if `cert.pem` is missing or expired at startup, it generates a
self-signed certificate automatically so HTTPS keeps working.

> ⚠ **Important** — if your custom certificate expires and is not renewed
> in time, the server will silently replace it on the next restart with
> a self-signed one. You lose the custom certificate (the file on disk
> is overwritten).

### Recommendations by certificate type

| Certificate type | Recommendation |
|---|---|
| **Let's Encrypt (90 days)** | Cron job that renews automatically before expiration (certbot does this natively) |
| **Long-term cert (1–2 years)** | Calendar reminder 30 days before the expiration date |
| **Short-lifetime cert (< 30 days)** | Automation is mandatory — renewal script + service restart |

---

## Disabling auto-regeneration (optional)

If you'd rather have the server fail loudly than silently fall back to
a self-signed certificate (e.g. in an environment where a non-compliant
cert is unacceptable), comment out the `try/catch` block that calls
`openssl req -x509` in `server/index.js` around line 95.

> **Note**: this is a local code change, so it has to be re-applied on
> every `git pull` that touches this file. A cleaner alternative would
> be to add a `SKIP_CERT_AUTOGEN=true` environment variable — a small
> improvement worth proposing as a pull request if this need recurs.

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
CA (instead of `CN=localhost` for the self-signed) and the validity
dates you expect.
