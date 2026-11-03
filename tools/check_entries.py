"""Compare score entry times with audio onsets in each vocal stem.

Usage: check_entries.py media/<season>/<slug>
For every note that follows a rest of at least 1 s, finds the nearest point where the part's stem
comes out of silence and prints onset-minus-score in seconds. Expect small positive values
(the voice patch's attack, roughly 0.02-0.05 s) throughout the piece.
"""
import json, re, subprocess, sys
piece = sys.argv[1]
d = json.load(open(f"{piece}/piece.json"))
a = d["audio"]


def stem_pcm(stem_dir):
    """The stem as raw mono f32le PCM, stitched from its chunks the way the page does it."""
    pcm = b""
    for k in range(-(-a["length"] // a["chunk"])):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", f"{stem_dir}/{k}.mp3", "-ac", "1", "-f", "f32le", "-"],
                             capture_output=True, check=True).stdout
        lead = a["pad"] if k else 0
        pcm += raw[lead * 4:(lead + a["chunk"]) * 4]
    return pcm


for v in d["voices"]:
    f = next(p["file"] for p in d["parts"] if p["name"] == v["name"])
    out = subprocess.run(["ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(a["rate"]), "-ac", "1", "-i", "-",
                          "-af", "silencedetect=n=-50dB:d=0.4", "-f", "null", "-"],
                         input=stem_pcm(f"{piece}/{f}"), capture_output=True).stderr.decode()
    onsets = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", out)]
    entries = [b["t0"] for a, b in zip([None] + v["notes"], v["notes"]) if a is None or b["t0"] - a["t1"] >= 1.0]
    diffs = []
    for e in entries:
        near = min(onsets, key=lambda o: abs(o - e), default=None)
        if near is not None and abs(near - e) < 0.5:
            diffs.append(round(near - e, 3))
    print(f"{v['name']:8} entries {len(entries):2} matched {len(diffs):2}  onset-minus-score (s): {diffs}")
