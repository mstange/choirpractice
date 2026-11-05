#!/bin/sh
# Usage: tools/build.sh path/to/score.mscz season/slug
# Produces media/<season>/<slug>/piece.json, media/<season>/<slug>/audio/<part>/<k>.mp3 (one stem
# per part, in chunks) and media/<season>/<slug>/engraving/<name>.svg (sheet music).
set -eu
MSCORE="${MSCORE:-/Applications/MuseScore 4.app/Contents/MacOS/mscore}"
TOOLS="$(cd "$(dirname "$0")" && pwd)"
OUT="$TOOLS/../media/$2"
if [ "$(defaults read org.musescore.MuseScore4 application.playback.metronomeEnabled 2>/dev/null)" = 1 ]; then
  echo "The metronome is enabled in MuseScore 4 and would be audible in every exported stem." >&2
  echo "Turn it off in MuseScore, or: defaults write org.musescore.MuseScore4 application.playback.metronomeEnabled -int 0" >&2
  exit 1
fi
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The piece is assembled in $PIECE and only replaces $OUT once every step has succeeded.
PIECE="$WORK/piece"
mkdir -p "$WORK/src" "$PIECE"
unzip -q "$1" -d "$WORK/src"
"$MSCORE" -o "$WORK/score.mid" "$1" >/dev/null 2>&1
"$MSCORE" -o "$WORK/score.musicxml" "$1" >/dev/null 2>&1
python3 -I "$TOOLS/extract.py" "$WORK/score.musicxml" "$WORK/score.mid" "$WORK/src" "$PIECE/piece.json"
python3 -I "$TOOLS/engrave.py" "$MSCORE" "$1" "$WORK/src" "$WORK/score.musicxml" "$WORK/score.mid" "$PIECE/piece.json" "$WORK"

python3 -I "$TOOLS/make_stems.py" "$WORK/src" "$PIECE/piece.json" "$WORK" > "$WORK/variants"
while IFS="$(printf '\t')" read -r score name; do
  "$MSCORE" -o "$WORK/$name.wav" "$score" >/dev/null 2>&1 &
done < "$WORK/variants"
wait

python3 -I "$TOOLS/encode_stems.py" "$WORK" "$PIECE/piece.json"

mkdir -p "$OUT"
rm -rf "$OUT/audio" "$OUT/engraving"
mv "$PIECE/piece.json" "$PIECE/audio" "$PIECE/engraving" "$OUT/"
