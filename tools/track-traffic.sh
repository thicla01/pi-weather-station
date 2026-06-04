#!/usr/bin/env bash
#
# track-traffic.sh — archive GitHub clone/view traffic beyond the 14-day window.
#
# GitHub only retains traffic stats for the last 14 days. This script fetches
# the current window via `gh api` and merges it into a local CSV, keeping one
# row per day. Re-runs are idempotent: a day already on file is updated to the
# higher count (partial "today" only ever grows), never duplicated.
#
# Output columns: date,clones,clone_uniques,views,view_uniques
#
# Usage:
#   tools/track-traffic.sh                 # append/merge into the default CSV
#   REPO=owner/name tools/track-traffic.sh # track a different repo
#   OUT=/path/to/file.csv tools/track-traffic.sh
#
# Requires: gh (authenticated), jq.

set -euo pipefail

REPO="${REPO:-thicla01/pi-weather-station}"
OUT="${OUT:-$HOME/.local/share/pi-weather-station/traffic-history.csv}"

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
