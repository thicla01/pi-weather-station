# Indoor temperature

Pulls a single indoor temperature reading (and humidity / air quality, when
the sensor exposes them) from a Homebridge instance via the
`homebridge-config-ui-x` REST API, and displays it in a minimal block to the
left of the clock in the info panel.

The feature is opt-in: it polls nothing and renders nothing unless an
`indoorTemperature` block is configured in `settings.json`. The interactive
prompt in `deploy/install.sh` (under "Advanced features") writes the block
for you — after you supply the Homebridge URL, username and password, the
script queries `/api/accessories`, lists every service exposing
temperature, humidity, or air quality (grouped by `serviceName` so a single
Dyson appears as one entry), and prompts you to pick one by number. The
manual setup below is for users editing `settings.json` directly, or for
fallback when the script cannot reach Homebridge.

## Configuration

```json
{
  "weatherApiKey": "...",
  "mapApiKey": "...",
  "indoorTemperature": {
    "enabled": true,
    "homebridgeUrl": "http://192.168.x.y:8581",
    "username": "admin",
    "password": "your-homebridge-password",
    "sensorName": "Purificateur bureau"
  }
}
```

After editing, restart the server:

```bash
systemctl --user restart pi-weather-server
```

| Field | Required | Notes |
|---|---|---|
| `enabled` | yes | Master toggle. When `false` or absent, the polling loop never starts and `/api/indoor-temperature` returns 404. |
| `homebridgeUrl` | yes | Base URL of your Homebridge UI, no trailing slash. Example: `http://192.168.x.y:8581`. |
| `username` / `password` | yes | Homebridge UI credentials. The server logs in once at startup and refreshes the JWT automatically. |
| `sensorName` | yes | Exact `serviceName` of the accessory exposed via Homebridge. Find it with the curl command below. |

## Finding sensor names

```bash
TOKEN=$(curl -s -X POST http://HOMEBRIDGE_IP:8581/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-pass"}' | jq -r .access_token)

curl -s http://HOMEBRIDGE_IP:8581/api/accessories \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.[] | {name: .serviceName, type: .type, temp: .values.CurrentTemperature, humidity: .values.CurrentRelativeHumidity}] | map(select(.temp != null or .humidity != null))'
```

Pick a `name` from the resulting list and use that exact string as
`sensorName`. When a single accessory exposes both temperature and humidity
under the same name (typical for Dyson air purifiers), both are picked up
automatically. Air quality (HomeKit `AirQuality`, 1=Excellent..5=Poor) is
also picked up when the accessory exposes an `AirQualitySensor` service
under the same name.

## Behaviour and defensive logic

- The server polls `/api/accessories` every 5 minutes
- Values outside `5°C..40°C` or `0%..100%` are rejected — keeps the last
  good reading instead of replacing it with garbage (e.g. a fan briefly
  returning `0°C` after a network glitch)
- `AirQuality` is read from any service named like the configured sensor
  (typical for Dyson air purifiers, which expose an `AirQualitySensor`
  service alongside their temperature/humidity ones). HomeKit values are
  `1=Excellent .. 5=Poor`; `0=Unknown` is rejected. Sensors that don't
  expose air quality (Hue, Haiku) simply hide that line in the UI.
- A 401 response triggers an automatic re-login (the JWT secret rotates
  when Homebridge restarts)
- Readings older than 30 minutes are flagged `isStale: true` in the API
  response; the UI dims the readout in that case
- The client polls `/api/indoor-temperature` every 60 seconds

## Endpoint reference

`GET /api/indoor-temperature`

```json
{
  "enabled": true,
  "value": 21.4,
  "humidity": 35,
  "airQuality": 1,
  "sensorName": "Purificateur bureau",
  "lastUpdated": "2026-04-26T18:32:11.000Z",
  "isStale": false
}
```

Returns `404 { "enabled": false }` when the feature is not configured.

## Security note

`settings.json` stores your Homebridge password in plain text. This matches
the existing convention for API keys in this file. The `indoorTemperature`
block is **never** returned to remote clients (`GET /settings` from outside
localhost strips it entirely), so credentials don't leak over the network.

If you change the Homebridge password, remember to update `settings.json`
and restart the server.

## Removing the feature

Delete the `indoorTemperature` block from `settings.json` (or set
`enabled: false`) and restart the server. The polling loop never starts,
the endpoint returns 404, and the UI component renders nothing.

## Migrating from the experimental POC

In the v2.5.x line, this feature was gated behind an
`experimental.indoorTemperature` block. v2.6.0 promotes it out of
experimental — the configuration moved up one level. If you have an
existing experimental block, move its contents to a top-level
`indoorTemperature` block:

```diff
 {
   "weatherApiKey": "...",
-  "experimental": {
-    "indoorTemperature": {
-      "enabled": true,
-      "homebridgeUrl": "...",
-      "username": "...",
-      "password": "...",
-      "sensorName": "..."
-    }
+  "indoorTemperature": {
+    "enabled": true,
+    "homebridgeUrl": "...",
+    "username": "...",
+    "password": "...",
+    "sensorName": "..."
   }
 }
```

`install.sh` will re-prompt for the configuration when re-run, so the
simplest path is to remove the old `experimental` block and let
`install.sh` write a fresh top-level one in the Advanced features section.
