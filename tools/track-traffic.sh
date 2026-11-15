#!/usr/bin/env bash
#
# track-traffic.sh — archive GitHub clone/view traffic beyond the 14-day window.
#
# GitHub only retains traffic stats for the last 14 days. This script fetches
# the current window via `gh api` and merges it into a local CSV, keeping one
# row per day. Re-runs are idempotent: a day already on file is updated to the
# higher count (partial "today" only ever grows), never duplicated.
#
# It also snapshots the top referrers. Unlike clones/views, GitHub's referrers
# feed is NOT a daily series — it's the top 10 over a rolling 14-day window — so
# it can't be a column in the daily CSV. Instead each run appends a dated
# snapshot to a second file, which freezes a referrer (e.g. a spam source) in
# local history before it ages out of GitHub's window. Re-running on the same
# day overwrites that day's snapshot; earlier days are kept.
#
# Output files (both under ~/.local/share/pi-weather-station/ by default):
#   traffic-history.csv    date,clones,clone_uniques,views,view_uniques
#   traffic-referrers.csv  snapshot_date,referrer,count,uniques   ("(none)" row when empty)
#
# Usage:
#   tools/track-traffic.sh                 # append/merge into the default CSVs
#   REPO=owner/name tools/track-traffic.sh # track a different repo
#   OUT=/path/to/file.csv tools/track-traffic.sh            # override the daily CSV
#   REFERRERS_OUT=/path/to/refs.csv tools/track-traffic.sh  # override the referrers CSV
#
# Requires: gh (authenticated), jq.

set -euo pipefail

REPO="${REPO:-thicla01/pi-weather-station}"
OUT="${OUT:-$HOME/.local/share/pi-weather-station/traffic-history.csv}"

# Non-interactive schedulers (launchd, cron) run outside the login session and
# cannot read gh's token from the macOS keychain, so `gh api` would 401 and the
# archive would silently stop updating. Feed the token via GH_TOKEN from a 0600
# file instead, which works regardless of keychain access. Interactive runs that
# already have GH_TOKEN set, or no token file, fall through to gh's own auth.
TOKEN_FILE="${GH_TOKEN_FILE:-$HOME/.config/pi-weather-station/gh-token}"
if [ -z "${GH_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
  GH_TOKEN="$(cat "$TOKEN_FILE")"
  export GH_TOKEN
fi

for bin in gh jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: '$bin' not found in PATH" >&2; exit 1; }
done

mkdir -p "$(dirname "$OUT")"
[ -f "$OUT" ] || echo "date,clones,clone_uniques,views,view_uniques" > "$OUT"

# Pull both feeds and join them by day (YYYY-MM-DD) into "date,c,cu,v,vu" rows.
fresh="$(
  jq -rn \
    --argjson clones "$(gh api "repos/$REPO/traffic/clones")" \
    --argjson views  "$(gh api "repos/$REPO/traffic/views")" '
    ( [ $clones.clones[] | { (.timestamp[0:10]): { c: .count, cu: .uniques } } ] | add // {} ) as $c |
    ( [ $views.views[]   | { (.timestamp[0:10]): { v: .count, vu: .uniques } } ] | add // {} ) as $v |
    ( ($c | keys) + ($v | keys) | unique ) | .[] as $d |
    [ $d,
      ($c[$d].c  // 0), ($c[$d].cu // 0),
      ($v[$d].v  // 0), ($v[$d].vu // 0) ] | @csv
  ' | tr -d '"'
)"

# Merge fresh rows with what's on disk, taking the max per metric per day.
merged="$(
  { tail -n +2 "$OUT"; echo "$fresh"; } | awk -F, '
    NF==5 {
      d=$1
      if (c[d]<$2) c[d]=$2
      if (u[d]<$3) u[d]=$3
      if (v[d]<$4) v[d]=$4
      if (w[d]<$5) w[d]=$5
      seen[d]=1
    }
    END { for (d in seen) printf "%s,%d,%d,%d,%d\n", d, c[d], u[d], v[d], w[d] }
  ' | sort
)"

{ echo "date,clones,clone_uniques,views,view_uniques"; echo "$merged"; } > "$OUT"

rows="$(( $(wc -l < "$OUT") - 1 ))"
echo "OK — $rows jour(s) archivé(s) dans $OUT"
echo "Dernières lignes :"
tail -n 5 "$OUT"

# --- Referrers: dated snapshots of the rolling top-10 (see header) -----------
REFERRERS_OUT="${REFERRERS_OUT:-$HOME/.local/share/pi-weather-station/traffic-referrers.csv}"
today="$(date +%F)"
mkdir -p "$(dirname "$REFERRERS_OUT")"
[ -f "$REFERRERS_OUT" ] || echo "snapshot_date,referrer,count,uniques" > "$REFERRERS_OUT"

# Secondary to the daily archive, so a referrers-only failure must not abort the
# run (the main CSV is already written above): tolerate a gh error and skip.
refs_json="$(gh api "repos/$REPO/traffic/popular/referrers" 2>/dev/null || true)"
if [ -n "$refs_json" ]; then
  # One "today,referrer,count,uniques" row per referrer; a "(none)" sentinel when
  # the window has no referrers, so the snapshot date is still on record.
  fresh_refs="$(
    jq -rn --arg d "$today" --argjson refs "$refs_json" '
      if ($refs | length) == 0 then [ $d, "(none)", 0, 0 ] | @csv
      else $refs[] | [ $d, .referrer, .count, .uniques ] | @csv end
    ' | tr -d '"'
  )"
  # Drop any existing rows for today (idempotent re-run), keep all earlier days,
  # then append today's fresh snapshot. Sorted by date, then referrer.
  ref_merged="$(
    { tail -n +2 "$REFERRERS_OUT" | awk -F, -v t="$today" '$1 != t'; echo "$fresh_refs"; } \
      | awk 'NF' | sort
  )"
  { echo "snapshot_date,referrer,count,uniques"; echo "$ref_merged"; } > "$REFERRERS_OUT"
  echo
  echo "Référents (instantané du $today) → $REFERRERS_OUT :"
  awk -F, -v t="$today" 'NR==1 || $1==t' "$REFERRERS_OUT"
else
  echo "warn: référents non récupérés (gh a échoué) — $REFERRERS_OUT inchangé" >&2
fi
