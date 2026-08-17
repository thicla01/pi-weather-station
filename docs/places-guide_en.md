# Places — saving the locations you check often

The **Places** list lets you keep a handful of locations and switch
between them with a single tap. Selecting one moves everything at
once: the temperature, the forecast, the radar, the alerts, the air
quality — and, if you have one, the Sense HAT display.

It is opened from the **bookmark icon** in the bottom bar.

> **One thing to understand first, and the rest follows.**
> The list has two kinds of row. Your **starting location** — the
> place the station shows when it powers up — always sits at the top,
> marked with a small house `⌂`. Below it are the places **you** saved.
> They look similar but behave differently, and most of the questions
> people have about this screen come from that distinction.

---

## Saving a place

There is no search box. You save **the place you are currently
looking at**, which on a touchscreen is faster than typing anyway.

1. Move the map to the place you want — drag it, or tap it.
2. Tap the **city name** at the top of the screen. A panel opens with
   the details of that location.
3. At the bottom of that panel, tap **Pin this place**.

It is added to your list, named automatically from the map data
(for example *Saint-Donat, Québec*). If the name is not what you
wanted, you can change it — see *Renaming* below.

If the button says **Pinned** instead, that place is already in your
list. If it is greyed out with *"List full"*, see *How many places*.

## Going to a saved place

Open **Places** and tap a row. The map moves there and the panel
closes. That is all — nothing to confirm, and you can always go back.

The row you are currently viewing is marked with a coloured bar along
its left edge.

## Changing the list — Edit mode

Tap **Edit** at the bottom of the Places panel. Three buttons appear
on each row:

| Button | What it does |
|---|---|
| `⌂` | Make this place your **starting location** |
| `✎` | **Rename** it |
| `✕` | **Remove** it from the list |

While Edit is on, tapping a row no longer moves the map — the rows
become editable instead. Tap **Done** when you have finished.

**Removing takes two taps.** The first tap on `✕` turns it into
**Remove?**; the second one deletes. If you wait about four seconds,
or tap something else, it cancels itself. This is deliberate: there is
no undo.

## Renaming

In Edit mode, tap `✎` on a row, type the new name, and press
**Enter**. **Esc** cancels. The panel reminds you of this under the
box.

Names are yours to choose — *Home*, *The cottage*, *Mum's place*.
Up to 40 characters.

> **You need a keyboard.** The station has no on-screen keyboard, so
> on a touchscreen with nothing plugged in, the box opens but you
> cannot type into it. Tap elsewhere and nothing is changed. Plug in a
> USB keyboard, or do it from a computer connected to the station.

## Your starting location

This is the place the station shows when it starts, and the place the
**recenter** button in the bottom bar returns to. It is the `⌂` row at
the top of the list.

By default it is worked out automatically from your internet
connection, which is usually accurate to the town.

**To change it:** open **Places** → **Edit** → tap `⌂` on the row you
want. The house mark moves to it, and it takes effect immediately —
no restart.

**To rename it:** the `⌂` row cannot be renamed directly, because it
is not really a saved place — it is a reminder of where the station
starts. Turn it into a real one first: in Edit mode, tap the `★` on
the `⌂` row. It becomes a normal row that you can rename with `✎`.

> **Where did the `⌂` row go?** This surprises people. Once you pin
> your starting location, it *becomes* one of your saved places — so
> the reminder row is no longer needed and disappears, and the little
> house moves onto your saved row instead. Nothing was lost; the same
> place is simply listed once instead of twice.

**To go back to automatic:** in Edit mode, tap `↺` on the `⌂` row.
The station goes back to working your location out from the internet
connection, straight away. This button only appears if a manual
location is actually set — if it is already automatic, there is
nothing to undo, so it is not shown.

> **Emptying the list does not reset your starting location.** If you
> remove every saved place, the station still starts where you told it
> to. That is on purpose — deleting a shortcut should not silently
> move your station. The `↺` above is how you return to automatic.

## How many places can I save?

**Six** — or **seven** if one of them is your starting location.

The reason is the size of the panel: it fits seven rows on the 7-inch
screen without scrolling, and the `⌂` row takes one of them. Pin your
starting location and that row is no longer needed, which frees the
slot for a real place.

At the limit, **Pin this place** is greyed out with *"List full"*.
Remove one you no longer use, and it comes back.

## From a phone or another computer

If you open the station from another device on your network, you can
**see the list and tap rows to move the map**, but the **Edit** button
is not there.

That is intentional. Changes are only accepted from the station
itself, so nobody else on the network can alter your settings. To make
changes from a computer, use the secure connection described in the
main documentation — it counts as the station itself.

---

## If something looks wrong

| What you see | What is happening |
|---|---|
| A place is named after the region only, like *Texas* | The map data has no town for that exact point, so only the wider area came through. Rename it to whatever suits you |
| The name is right but you would prefer your own | Edit → `✎`. Names are free text |
| *"List full"* on the pin button | You are at the limit. Remove one, or pin your starting location to free a slot |
| The `✎` opens a box you cannot type into | No keyboard attached — see *Renaming* |
| No **Edit** button | You are connected from another device — see above |
| The `⌂` row disappeared | You pinned it; the house mark is now on your saved row |
| It still starts in the wrong place after deleting everything | The starting location is separate from the list — use `↺` on the `⌂` row |
| Tapping a row does nothing | Edit mode is on. Tap **Done** first |

Names and lists are stored on the station itself, not in the browser,
so they survive a restart and are included in a backup of the
station's settings.
