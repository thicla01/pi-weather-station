# Proposal — "Nearby alerts" map overlay (feedback wanted)

**Status:** idea under consideration, not built yet. Sharing it to gauge whether it would actually be useful before any code is written.
**Audience:** anyone who monitors weather alerts on a fixed-location kiosk — and specifically the AllStarLink / SkywarnPlus crowd, since this idea came directly out of one of your reports.

---

## Where this came from

A SkywarnPlus user heard a **Flood Advisory** announced on his node, looked at his Pi Weather Station kiosk, and saw nothing. Reasonable reaction: "is the station broken?"

It turned out **not** to be a bug — it's a difference in *how the two tools ask the National Weather Service the same question*:

| | How it queries NWS | What it returns |
|---|---|---|
| **SkywarnPlus** | by **county code** (SAME/UGC, e.g. `TXC201`) | every alert that touches the **whole county** |
| **Pi Weather Station** | by **exact point** (`api.weather.gov/alerts/active?point=lat,lon`) | only alerts whose **polygon/zone covers your specific location** |

In that case the only flood product was a single **Flood Advisory** whose polygon was a band spanning several counties — it touched the county (so SkywarnPlus announced it) but did **not** cover the user's actual coordinates (so the point-based station correctly stayed silent).

Neither approach is "more correct." A repeater serves a whole region, so **county-wide is exactly right** for SkywarnPlus. A fixed kiosk shows **your** location, so **point-precise is right** for the station — it keeps the banner quiet about a storm 40 miles away on the far side of the county.

But it raised a fair question: **what if you're curious about what's active *around* you, not just *at* you?** That's what this proposal is about.

## The idea

An **optional map layer** you turn on when you want it. When ON, it paints every active NWS / Environment Canada alert polygon **in your region** (your state or province) on top of the map, colour-coded by severity:

- 🔴 **Red** — Warnings (Tornado, Severe Thunderstorm, Flash Flood, etc.)
- 🟠 **Orange** — Watches
- 🟡 **Yellow** — Advisories

Tap a polygon → a small popup tells you **what it is**: the alert type (e.g. "Flood Advisory"), its severity colour, and when it expires.

That's the whole feature. Deliberately modest.

## What it deliberately does *not* change

This is the important part, and the reason the idea is even on the table:

- **It does not touch the alert banner, the audible/visual alerting, or anything that "fires."** Those stay strictly point-based, exactly as today. The overlay is a *look-around* tool, not a new trigger. No new noise.
- **It's off by default** — you opt in when you want to survey the area.
- **It doesn't try to show the whole continent** — just your region, so the map stays readable and it runs fine on a Raspberry Pi.

## "What if I want the full details of an alert near me?"

You already can, for free: **drag your location** on the map (or set it) into the area you're curious about, and the normal point-based path lights up — full alert banner, full description text, everything. So the overlay stays lightweight (just the *subject* on tap), and the rich detail you get by simply re-centering on the zone of interest.

This is why the popup only shows the headline rather than the full text — there's already a clean way to get the full read, and duplicating it would just add clutter.

## Questions we'd love your take on

1. **Would you actually use this?** Be honest — is "see what's active around me" something you'd reach for, or does SkywarnPlus already cover that need for you?
2. **Region size.** Is "your state/province" the right scope? Too big? Would a fixed radius (say ~50 mi) feel more natural for a ham covering a specific service area?
3. **The tap popup.** Is alert type + severity + expiry enough at a glance, or would you want more right there in the popup?
4. **Advisories (yellow).** Show them in the overlay by default, or keep yellow off unless you ask for it (to cut clutter)?
5. **Anything missing?** Is there a piece of how SkywarnPlus presents alerts that you find genuinely useful and would want here?

No commitment to build implied — your answer to #1 mostly decides whether it's worth doing at all. Thanks for the original report; it's exactly the kind of real-world friction that makes for a good feature (or a good reason *not* to build one).
