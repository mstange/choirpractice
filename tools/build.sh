#!/bin/sh
# Usage: tools/build.sh path/to/score.mscz season/slug
# Produces media/<season>/<slug>/piece.json, media/<season>/<slug>/score.mid (the music, played by
# the page) and media/<season>/<slug>/engraving/<name>.svg (sheet music), and adds the soundfont
# files of the score's instruments to media/soundfont/. Keeps a copy of the score as
# media/<season>/<slug>.mscz, so that the piece can be rebuilt with tools/rebuild.sh.
set -eu
MSCORE="${MSCORE:-/Applications/MuseScore 4.app/Contents/MacOS/mscore}"
TOOLS="$(cd "$(dirname "$0")" && pwd)"
OUT="$TOOLS/../media/$2"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The piece is assembled in $PIECE and only replaces $OUT once every step has succeeded.
PIECE="$WORK/piece"
mkdir -p "$WORK/src" "$PIECE"
unzip -q "$1" -d "$WORK/src"
"$MSCORE" -o "$PIECE/score.mid" "$1" >/dev/null 2>&1
"$MSCORE" -o "$WORK/score.musicxml" "$1" >/dev/null 2>&1
python3 -I "$TOOLS/extract.py" "$WORK/score.musicxml" "$PIECE/score.mid" "$WORK/src" "$PIECE/piece.json"
python3 -I "$TOOLS/engrave.py" "$MSCORE" "$1" "$WORK/src" "$WORK/score.musicxml" "$PIECE/score.mid" "$PIECE/piece.json" "$WORK"

mkdir -p "$OUT"
rm -rf "$OUT/audio" "$OUT/engraving"
mv "$PIECE/piece.json" "$PIECE/score.mid" "$PIECE/engraving" "$OUT/"
[ "$1" -ef "$OUT.mscz" ] || cp "$1" "$OUT.mscz"
python3 -I "$TOOLS/phonemes.py" "$OUT"
node "$TOOLS/../site/scripts/soundfont.ts"
