# Security Hardening — Kiosk Deployments

When a Pi Weather Station is deployed in a location with casual public access
(shared office, barn tack room, waiting area, etc.), the main threat isn't a
determined attacker — it's opportunistic physical access: someone plugs in a
USB stick or keyboard, or tries the console. `deploy/harden-kiosk.sh` applies
a focused set of mitigations for exactly that threat model.

This document explains what the script does, why each step matters, and how to
undo any of them.

## When to use this

Use the hardening script when **all** of the following are true:

- The Pi is in a physical location accessible to people you don't control
- It runs as a kiosk (Chromium full-screen), with no permanent keyboard or
  touchscreen expected during normal operation
- It's on a dedicated IoT VLAN (not your main LAN)
- You have SSH key-based access from a trusted workstation

If you run the station on a desk at home and trust everyone with physical
access, you don't need this.

## Threat model and what's out of scope

In scope:

- Someone plugs a USB mass-storage device into the Pi
- Someone plugs a USB keyboard and tries Ctrl+Alt+F2 to get a shell
- Someone plugs a BadUSB-style device (USB stick that masquerades as a
  keyboard and types attack commands)
- An attacker on the IoT VLAN tries to SSH in with guessed passwords
- Malware already on the Pi trying to exfiltrate data to arbitrary servers
- A remote user with `ALLOW_REMOTE=true` access tries to inflate the
  Anthropic API bill by toggling AI radar settings (see "Cost-related
  controls" below)

Out of scope (by design — see the "If you need more" section):

- A determined attacker with time alone and tools (SD card extraction)
- Network attackers with your SSH key
- Supply-chain compromise of the software you install

## Prerequisites

**Before running the script, verify SSH key-based access works.** The script
disables password authentication — if you don't have a working key, you will
be locked out after rebooting.

From your workstation:

```bash
# One-time, if you've never set up a key for this Pi:
ssh-copy-id pi@<pi-ip>

# Verify key auth works without a password prompt:
ssh pi@<pi-ip> whoami
```

If that last command prints `pi` without asking for a password, you're ready.

## Running the script

Copy it to the Pi and run with sudo:

```bash
scp deploy/harden-kiosk.sh pi@<pi-ip>:/tmp/
ssh pi@<pi-ip>
sudo bash /tmp/harden-kiosk.sh
```

The script is idempotent — running it again is safe. Steps that can lock you
out (firewall, SSH) prompt for confirmation before applying.

Reboot after it finishes to load the `usb-storage` blacklist into the kernel.

## What each step does

### 1. Blacklist the `usb-storage` kernel module

Writes `/etc/modprobe.d/disable-usb-storage.conf`. The kernel no longer loads
the driver that handles USB flash drives, external HDDs, etc., so plugging one
in does nothing visible at the OS level. HID devices (keyboard, mouse,
SenseHAT) are unaffected.

Why: the most common casual attack is "run something from a USB stick." This
closes that door cheaply.

Undo: `sudo rm /etc/modprobe.d/disable-usb-storage.conf && sudo update-initramfs -u && sudo reboot`

### 2. Mask unused virtual terminals

`systemctl mask getty@tty2..tty6`. Leaves `tty1` (which the Chromium kiosk
runs on) alone. Without this, a plugged-in keyboard can Ctrl+Alt+F2 to jump
to a login prompt on `tty2`.

Why: defense in depth. Even with `usbguard` allowlisting, disabling shell
entry points from the console is a near-zero-cost win.

Undo: `sudo systemctl unmask getty@tty2.service` (repeat for 3..6)

### 3. `usbguard` with allowlist

Installs `usbguard` and generates a policy from the devices currently
connected. Any USB device not matching the allowlist is blocked at the kernel
level — including BadUSB devices that pretend to be keyboards.

Why: a USB device that types attack commands on its own (rubber ducky,
BadUSB) is a serious risk for public-access kiosks. `usbguard` is the only
clean defense — the blacklist at step 1 only handles storage, not HID.

The script asks before generating the policy because the allowlist captures
whatever is plugged in **right now**. Make sure only trusted devices are
connected before confirming.

Maintenance: if you later need to plug in a new keyboard for maintenance,
either re-run the script (regenerates the allowlist) or use
`sudo usbguard list-devices` + `usbguard allow-device <id>` to accept it
manually.

Undo: `sudo systemctl disable --now usbguard`

### 4. Outbound-restrictive firewall (`ufw`)

Configures `ufw` with:

- All incoming denied by default
- All outgoing denied by default
- Outgoing allowed: DNS (53), HTTP (80), HTTPS (443), NTP (123)
- Incoming allowed from the local subnet only: SSH (22), HTTPS (8443). The cleartext `:8080` fallback is **not** opened — the server binds it to loopback only (it refuses to serve unencrypted over the LAN), so there is nothing to allow there.

Why: if something does run on the Pi despite the other layers, this caps what
it can do — it can't reach an attacker-controlled server on an arbitrary
port. It also blocks all inbound traffic from outside the VLAN.

The local subnet is auto-detected from the Pi's primary interface. If you
SSH in from a different subnet, either add your workstation's IP manually
after the script runs, or run the script from the console.

If you use the Homebridge indoor-temperature integration, its port (usually
`8581`) is not on the outbound allowlist, so indoor readings stop once the
firewall is enabled. Allow it after the script runs, e.g.
`sudo ufw allow out to <homebridge-ip> port 8581 proto tcp`.

Undo: `sudo ufw disable`

### 5. SSH hardening

Writes `/etc/ssh/sshd_config.d/99-harden-kiosk.conf` with:

- `PasswordAuthentication no` — only SSH keys accepted
- `PermitRootLogin no`
- `ChallengeResponseAuthentication no`

Why: brute-force attempts over SSH are constant on anything reachable, even
on an IoT VLAN. Key-only auth makes guessing attacks impossible.

The script tests the config with `sshd -t` before reloading, so a syntax
error doesn't break SSH. If the test fails, the override file is removed
automatically.

Undo: `sudo rm /etc/ssh/sshd_config.d/99-harden-kiosk.conf && sudo systemctl reload ssh`

## Verifying it worked

After rebooting:

```bash
# usb-storage should not be loaded
lsmod | grep usb_storage   # expect empty output

# unused virtual terminals masked (repeat for tty3..tty6)
systemctl is-enabled getty@tty2.service   # expect: masked

# usbguard active
systemctl status usbguard

# firewall active with expected rules
sudo ufw status verbose

# SSH only accepts keys
ssh -o PreferredAuthentications=password pi@<pi-ip>   # should be rejected
```

Plug an unknown USB stick or keyboard into the Pi — it should be visible in
`sudo usbguard list-devices` with status `block`, and have no effect on the
system.

## Cost-related controls

Beyond classical network/physical hardening, a Pi Weather Station instance
can incur real money through its paid integrations. The defenses below are
in place by default and should not be relaxed without thinking through
the billing implications.

### Threat: a remote user inflates the API bill

The AI weather summary consumes Anthropic API tokens. Each refresh of the
summary makes at most one Claude call (cached 15 min server-side; a
truncated reply only 5 min, and a refusal or empty reply not at all, so the
next poll retries it). The size and behavior of that call is controlled by
`advanced.ai.*` settings:

| Setting | Effect on Claude billing |
|---|---|
| `radarAnalysisEnabled` | Adds a third paragraph fed by RainViewer samples — larger prompt, larger response |
| `extendedRadius` | Adds the outer-ring samples (161 → 481 points fed to the prompt) — meaningfully larger context |
| `showSamplingPoints` | Purely client-side rendering; no billing impact |
| `calmDayFastPath` | On (default): calm days skip the Claude call and serve a localised template (gates in [api.md](api.md)). Turning it off makes every cache miss a billed call |

The per-toggle impact is small — a whole call cost well under a cent even
on Haiku 4.5, and on Haiku 5.5 it is ≈ $0.0001 without radar to ≈ $0.0011
with the extended-radius radar block over real precipitation (measured
2026-10-08) — but the
aggregate risk on a long-running deployment is real, and the principle
matters: **only the device owner should be able to dial up settings that
bill against their API key**.

### How it's enforced

- `PATCH /setting` (and POST/PUT/DELETE) is unconditionally `localhostOnly`.
  A remote client cannot change `advanced.ai.*` even if `ALLOW_REMOTE=true`.
- `GET /settings` is allowed remote, but the response masks API key fields
  to booleans so a remote viewer can confirm the key is configured without
  reading it.
- The Settings UI shows the Advanced section to remote clients in read-only
  mode (dimmed, controls disabled); the notice directing the user to open
  an SSH tunnel for actual changes appears in the Configuration & API keys
  section. The UI lock is cosmetic — the server-side `localhostOnly` is the
  real enforcement.
- **Billed-call ceiling.** The settings lock bounds what each call costs;
  this bounds how many calls a remote client can make. `aiSummaryCtrl`
  reserves a slot before every Claude call that a remote request triggers:
  at most `MAX_CLAUDE_CALLS_PER_MIN` (10) per sliding minute for all remote
  peers combined, and `MAX_CLAUDE_CALLS_PER_MIN_PER_PEER` (4) for any one
  socket peer. Over either, the endpoint answers 429 without calling
  Anthropic. The ceiling is per process and in memory. The local kiosk
  (`req.isLocal`, from the socket peer) is exempt, so a remote flood can't
  starve its own refresh. The summary cache can't give this guarantee,
  because its key can be jittered. Dollar bound, worst case (every call a
  ~4.2K-token stormy extended-radius prompt, as measured live, that fills
  the whole 3,072-token `MAX_TOKENS_RADAR` cap): 10 calls/min × 1,440 min ×
  (4.2K × $0.10/MTok + 3,072 × $0.50/MTok) ≈ **$28/day** on Haiku 5.5,
  against ≈ $75/day on Haiku 4.5 at its old 400-token cap ($1 / $5 per MTok;
  its tokenizer counts the same prompt as ~3.2K tokens). The output cap is ~80 % of
  that figure, so raising the `MAX_TOKENS_*` caps raises the bound.
  The kiosk's own refreshes come on top.

#### What `GET /settings` still exposes to a remote client

Masking hides secrets, not coordinates. `startingLat` / `startingLon` have
always reached remote clients verbatim, and as of the favorite-locations
feature so does `favorites` — up to seven labelled `{lat, lon}` pairs naming
places the operator cares about. This is a deliberate call (the SSH-tunnel
and LAN workflows both need to read the list), but it widens the location
exposure from one point to several, and the labels are user-authored text.

If that is not acceptable for a given deployment, add `favorites` to
`REMOTE_HIDDEN_KEYS` in `server/settingsCtrl.js`: the subtree then disappears
from remote responses entirely, at the cost of the Places list rendering
empty for remote viewers. Editing is unaffected either way — every write path
is `localhostOnly`.

### Recommendations beyond the defaults

- Set per-period quotas (a spend limit plus spend alerts) in the Anthropic
  Console so a misbehaving deploy cannot run away with billing. The
  ceiling above caps call *count*, not dollars, and the debug panel's
  per-endpoint request counters only count. Haiku 5.5 brought the per-call
  price down to roughly a quarter of Haiku 4.5's, so lower any threshold
  sized for the old bill: legitimate use is about one billed call per
  15-minute cache window per kiosk and location (≈ 96/day, so ≈ $0.06-0.10/day
  at the measured radar cost on Haiku 5.5 and ≈ $0.19/day if every call hit
  the worst case above, less on calm days). An alert at about $8 a month
  per kiosk still leaves headroom, and a remote flood saturating the
  ceiling (≈ $28/day) trips it quickly. A threshold sized for the Haiku 4.5
  bill would let the same flood run several times longer before anyone
  hears about it.
- For multi-Pi deployments, prefer one API key per device rather than one
  shared key — limits blast radius if a single device is compromised.
- Watch for unexpected spikes in `services` activity in the debug panel,
  particularly Anthropic call rates. A sudden 24x jump is more likely
  configuration drift than an attack but worth investigating either way.
  A 429 with the comment `throttled (per-process call ceiling)` on the
  `Claude (AI summary)` service row means the billed-call ceiling is biting,
  which legitimate remote traffic never does.

## TLS / SSL — using your own certificate

The server generates a self-signed root CA plus a leaf certificate signed
by it, and re-checks the chain at every start (leaf SAN: `localhost`,
`127.0.0.1`, every LAN IPv4, and `<hostname>` / `<hostname>.local`,
whether or not `ALLOW_REMOTE` is set — see "Certificate architecture" in
the guide linked below). For a real deployment, you usually want a
certificate signed by an authority your clients already trust (Let's
Encrypt, your corporate CA, mkcert for LAN-only). The substitution is
straightforward — replace `server/cert.pem` and `server/key.pem`, set
`SKIP_CERT_AUTOGEN=true` in the service environment (otherwise the server
overwrites them on the next start), and restart the service. Full
procedure, conversion from PKCS#12, and the auto-regeneration caveat
are documented in [docs/ssl-custom-cert_en.md](ssl-custom-cert_en.md) (French version: [ssl-custom-cert_fr.md](ssl-custom-cert_fr.md)).

## If you need more

The script deliberately stops before things that cost significantly more to
maintain. If your threat model includes a determined attacker with time
alone, consider:

- **Read-only root filesystem** (`overlayroot`) — makes persistence nearly
  impossible, but requires temporarily disabling the overlay for every update
  and breaks persistence of `settings.json`, `weather-cache.json`, and
  `request-counts.json`. Discuss with a maintainer before attempting.
- **Full-disk encryption** (LUKS + Clevis/Tang for network unlock, or TPM) —
  prevents data extraction from a stolen SD card. Complex to set up on Pi OS.
- **Intrusion detection** (`auditd`, remote syslog) — detect tampering after
  the fact.
- **Tamper-evident enclosure** — physical security: if the case is opened,
  you see it.
