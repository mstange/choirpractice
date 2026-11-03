"""Write one copy of a score per part with every other part muted, plus one with all parts muted.

Usage: make_stems.py extracted_mscz_dir piece.json workdir
Prints "<variant .mscz>\t<name>" per variant. Names are the stem names from piece.json's "parts"
(which follow the score's part order), and "baseline" for the all-muted variant: MuseScore renders a
short sound at the very start even with every part muted, which must be subtracted from each stem.
"""
import json, pathlib, re, shutil, sys

src, piece, work = pathlib.Path(sys.argv[1]), json.load(open(sys.argv[2])), pathlib.Path(sys.argv[3])
mscx_path = next(src.glob("*.mscx"))
mscx = mscx_path.read_text()
part_xml = re.findall(r"<Part[ >].*?</Part>", mscx, re.S)
assert len(part_xml) == len(piece["parts"]), "part count differs between .mscx and MusicXML"

variants = [(i, pathlib.Path(p["file"]).stem) for i, p in enumerate(piece["parts"])] + [(None, "baseline")]
for keep, name in variants:
    variant = work / f"variant-{name}"
    shutil.copytree(src, variant)
    if (src / "audiosettings.json").exists():
        # MuseScore 4: mute state lives in audiosettings.json, keyed by part id.
        keep_id = keep is not None and re.match(r'<Part id="(\d+)"', part_xml[keep]).group(1)
        settings = json.load(open(src / "audiosettings.json"))
        for track in settings["tracks"]:
            # Tracks that were never muted/soloed in MuseScore have no soloMuteState at all.
            track["soloMuteState"] = {"mute": track["partId"] != keep_id, "solo": False}
        json.dump(settings, open(variant / "audiosettings.json", "w"), indent=4)
    else:
        # MuseScore 3: mute flags on each instrument channel.
        out = mscx
        for j, p in enumerate(part_xml):
            if j != keep:
                out = out.replace(p, p.replace("</Channel>", "<mute>1</mute></Channel>"), 1)
        (variant / mscx_path.name).write_text(out)
    archive = pathlib.Path(shutil.make_archive(str(variant), "zip", variant))
    print(f"{archive.rename(archive.with_suffix('.mscz'))}\t{name}")
