#!/bin/sh
# Usage: tools/build.sh path/to/score.mscz season/slug
# Produces media/<season>/<slug>/piece.json, media/<season>/<slug>/score.mid (the music, played by
# the page) and media/<season>/<slug>/engraving/<name>.svg (sheet music), and adds the soundfont
# files of the score's instruments to media/soundfont/.
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
# Some scores give notes a playback event of length 0, which MuseScore's MIDI export plays as
# silence (an automated transcription did that to all its grace notes). The score is exported
# from a copy without such events.
python3 -I -c '
import pathlib, re, sys
for p in pathlib.Path(sys.argv[1]).glob("*.mscx"):
    p.write_text(re.sub(r"\s*<Events>\s*<Event>\s*<len>0</len>\s*</Event>\s*</Events>", "", p.read_text()))
' "$WORK/src"
(cd "$WORK/src" && zip -qr "$WORK/score.mscz" .)
"$MSCORE" -o "$PIECE/score.mid" "$WORK/score.mscz" >/dev/null 2>&1
"$MSCORE" -o "$WORK/score.musicxml" "$WORK/score.mscz" >/dev/null 2>&1
python3 -I "$TOOLS/extract.py" "$WORK/score.musicxml" "$PIECE/score.mid" "$WORK/src" "$PIECE/piece.json"
python3 -I "$TOOLS/engrave.py" "$MSCORE" "$WORK/score.mscz" "$WORK/src" "$WORK/score.musicxml" "$PIECE/score.mid" "$PIECE/piece.json" "$WORK"

mkdir -p "$OUT"
rm -rf "$OUT/audio" "$OUT/engraving"
mv "$PIECE/piece.json" "$PIECE/score.mid" "$PIECE/engraving" "$OUT/"
node "$TOOLS/../site/scripts/soundfont.ts"
