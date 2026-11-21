#!/bin/sh
# Usage: tools/rebuild.sh [season...]
# Rebuilds every piece of the given seasons (all seasons by default) from its media/<season>/<slug>.mscz.
set -eu
MEDIA="$(cd "$(dirname "$0")/../media" && pwd)"
[ $# -gt 0 ] || set -- $(cd "$MEDIA" && ls */pieces.json | xargs -n1 dirname)
for season; do
  for score in "$MEDIA/$season"/*.mscz; do
    [ -e "$score" ] || continue
    slug="$(basename "$score" .mscz)"
    echo "== $season/$slug"
    "$(dirname "$0")/build.sh" "$score" "$season/$slug"
  done
done
