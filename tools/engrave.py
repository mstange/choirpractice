"""Engrave the vocal parts as single long lines of sheet music, with the x position of every note.

Usage: engrave.py mscore score.mscz extracted_mscz_dir score.musicxml score.mid piece.json workdir
Writes one variant of the score per vocal part with every other part hidden, plus a "choir" variant
with all vocal parts (when there are two to MAX_CHOIR of them), each laid out as one system on a very wide page.
MuseScore exports each as a trimmed SVG and as segment positions (.spos), which give the x position
of every chord or rest; the times come from the .spos of the unchanged score, and the MusicXML and
MIDI exports tell which of those belong to the shown parts. Writes <piece dir>/engraving/<name>.svg
and adds an "engravings" entry to piece.json.
"""

import bisect, concurrent.futures, json, os, pathlib, re, shutil, subprocess, sys
import xml.etree.ElementTree as ET

sys.path.append(str(pathlib.Path(__file__).parent))
from extract import parse_part, time_map

mscore, score, src, xml_path, mid_path, piece_path, work = (
    sys.argv[1],
    *map(pathlib.Path, sys.argv[2:8]),
)
piece = json.loads(piece_path.read_text())
out = piece_path.parent / "engraving"
mscx_path = next(src.glob("*.mscx"))
mscx = mscx_path.read_text()
assert (src / "score_style.mss").exists(), "no score_style.mss: MuseScore 3 files are not supported"
style = (src / "score_style.mss").read_text()
part_xml = re.findall(r"<Part[ >].*?</Part>", mscx, re.S)
assert len(part_xml) == len(piece["parts"]), "part count differs between .mscx and MusicXML"
to_sec = time_map(mid_path)
onsets = [
    {to_sec(q) for q in parse_part(part)[2]}
    for part in ET.parse(xml_path).getroot().findall("part")
]
# Hiding parts can change how MuseScore stretches the time at a fermata whose staves don't all have
# it on the same beat, so a variant's .spos times can be later than the audio's.
# The variants have the same segments as the unchanged score, whose .spos times match the MIDI.
read_times = lambda spos: dict(re.findall(r'<event elid="(\d+)" position="(\d+)"', spos))
subprocess.run([mscore, "-o", work / "score.spos", score], check=True, capture_output=True)
times = read_times((work / "score.spos").read_text())

STYLE = {
    # Wide enough for any piece to fit on one line; MuseScore doesn't stretch a mostly empty last system.
    "pageWidth": 2000,
    "pagePrintableWidth": 1999,
    "pageHeight": 100,
    "lyricsMinDistance": 1,
    # A header or footer, such as the copyright line, would sit far from the music on that page.
    "showHeader": 0,
    "showFooter": 0,
    "showPageNumber": 0,
}
for tag, value in STYLE.items():
    style, n = re.subn(rf"<{tag}>[^<]*</{tag}>", f"<{tag}>{value}</{tag}>", style)
    assert n == 1, f"{tag} not found in score_style.mss"
# Frames and layout breaks would start new systems.
layout = re.sub(r"\s*<(VBox|TBox)>.*?</\1>", "", mscx, flags=re.S)
layout = re.sub(r"\s*<LayoutBreak>.*?</LayoutBreak>", "", layout, flags=re.S)

vocal = [i for i, p in enumerate(piece["parts"]) if p["vocal"]]
variants = [(pathlib.Path(piece["parts"][i]["file"]).name, [i]) for i in vocal]
# On a strip of reasonable height, the staves of a bigger choir would be too small to read.
MAX_CHOIR = 4
if 1 < len(vocal) <= MAX_CHOIR:
    variants.append(("choir", vocal))


def engrave(name, shown):
    variant = work / f"engrave-{name}"
    shutil.copytree(src, variant)
    (variant / "score_style.mss").write_text(style)
    text = layout
    for j, p in enumerate(part_xml):
        if j not in shown:
            text = text.replace(p, p.replace("<Staff>", "<show>0</show>\n      <Staff>", 1), 1)
    (variant / mscx_path.name).write_text(text)
    score = pathlib.Path(shutil.make_archive(str(variant), "zip", variant)).rename(
        variant.with_suffix(".mscz")
    )
    # The trimmed SVG is shifted against the page coordinates of the .spos; the untrimmed one gives the shift.
    for args, dst in [([], "page.svg"), (["-T", "0"], "trim.svg"), ([], "x.spos")]:
        subprocess.run([mscore, *args, "-o", variant / dst, score], check=True, capture_output=True)
    pages = sorted(variant.glob("page-*.svg"))
    assert len(pages) == 1, f"{name}: {len(pages)} pages"
    page, trim = pages[0].read_text(), (variant / "trim-1.svg").read_text()
    first_x = lambda svg: float(
        re.search(r'class="StaffLines"[^>]*points="([-\d.]+),', svg).group(1)
    )
    dx = first_x(page) - first_x(trim)

    spos = (variant / "x.spos").read_text()
    assert read_times(spos).keys() == times.keys(), f"{name}: segments differ from the score's"
    segs = re.findall(r'<element id="(\d+)" x="([-\d.e+]+)" y="([-\d.e+]+)" sx="([-\d.e+]+)"', spos)
    systems = {y for _, _, y, _ in segs}
    assert len(systems) == 1, f"{name}: {len(systems)} systems"
    # Positions are in 1/12 of SVG units, and x is the left edge of the segment's noteheads.
    # Segments where only hidden parts have notes get meaningless positions, so keep only those at
    # which a shown part has a note or rest (.spos times are rounded to milliseconds).
    shown_onsets = sorted(set().union(*(onsets[i] for i in shown)))

    def visible(t):
        k = bisect.bisect_left(shown_onsets, t - 0.0015)
        return k < len(shown_onsets) and shown_onsets[k] <= t + 0.0015

    points = [(int(times[i]) / 1000, float(x) / 12 - dx) for i, x, _, _ in segs]
    points = [(t, x) for t, x in points if visible(t)]
    assert all(a[0] < b[0] and a[1] < b[1] for a, b in zip(points, points[1:])), (
        f"{name}: x or time not increasing"
    )

    # Drop the white page background, and size the SVG in its own units so that drawing code can use them.
    trim = re.sub(r'<path class="" fill="#ffffff"[^>]*/>\n', "", trim, count=1)
    w, h = re.search(r'viewBox="0 0 ([\d.e+]+) ([\d.e+]+)"', trim).groups()
    trim = re.sub(
        r'<svg width="[^"]*" height="[^"]*"', f'<svg width="{w}" height="{h}"', trim, count=1
    )
    (out / f"{name}.svg").write_text(trim)
    # The distance between the first two staff lines; the page sizes sheets by it.
    y0, y1 = map(float, re.findall(r'class="StaffLines"[^>]*points="[-\d.]+,([-\d.]+)', trim)[:2])
    return {
        "parts": [piece["parts"][i]["name"] for i in shown],
        "file": f"engraving/{name}.svg",
        "width": float(w),
        "height": float(h),
        "spatium": round(y1 - y0, 2),
        "t": [round(t, 3) for t, _ in points],
        "x": [round(x, 1) for _, x in points],
    }


shutil.rmtree(out, ignore_errors=True)
out.mkdir()
with concurrent.futures.ThreadPoolExecutor(os.cpu_count()) as pool:
    piece["engravings"] = list(pool.map(lambda v: engrave(*v), variants))
piece_path.write_text(json.dumps(piece, indent=0))
for e in piece["engravings"]:
    print(
        f"engraving {e['file']}: {e['width'] / 1200:.0f} x {e['height'] / 1200:.1f} in, {len(e['t'])} segments",
        file=sys.stderr,
    )
