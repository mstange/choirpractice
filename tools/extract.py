"""Extract timed notes and lyric syllables per vocal part from a MusicXML export.

Usage: extract.py score.musicxml score.mid src_dir out.json

Both input files must be exported by MuseScore from the same score; src_dir holds the
unpacked .mscz, whose title frame gives the title and credits. Timing comes from the
MIDI file, so the tempo map (fermatas, ritardandos, ...) matches MuseScore's audio export.
Score positions are assumed to map 1:1 to MIDI ticks, i.e. the score has no repeats.
"""
import html, json, re, struct, sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PLACEHOLDERS = {"Untitled score", "Composer / arranger", "Subtitle", "Lyricist"}


def varlen(data, p):
    value = 0
    while True:
        b = data[p]
        p += 1
        value = (value << 7) | (b & 0x7F)
        if b < 0x80:
            return value, p


def midi_tempo_map(path):
    """Returns (division, [(tick, seconds, seconds_per_tick)])."""
    data = open(path, "rb").read()
    assert data[:4] == b"MThd"
    _, _, ntracks, division = struct.unpack(">IHHH", data[4:14])
    pos, tempos = 14, []
    for _ in range(ntracks):
        assert data[pos:pos + 4] == b"MTrk"
        (length,) = struct.unpack(">I", data[pos + 4:pos + 8])
        p, end, tick, status = pos + 8, pos + 8 + length, 0, 0
        while p < end:
            delta, p = varlen(data, p)
            tick += delta
            if data[p] >= 0x80:
                status = data[p]
                p += 1
            if status == 0xFF:
                mtype = data[p]
                ln, p = varlen(data, p + 1)
                if mtype == 0x51:
                    tempos.append((tick, int.from_bytes(data[p:p + 3], "big")))
                p += ln
            elif status in (0xF0, 0xF7):
                ln, p = varlen(data, p)
                p += ln
            else:
                p += 1 if (status & 0xF0) in (0xC0, 0xD0) else 2
        pos = end
    segs, sec, last_tick, spt = [(0, 0.0, 0.5 / division)], 0.0, 0, 0.5 / division
    for tick, uspq in sorted(tempos):
        sec += (tick - last_tick) * spt
        last_tick, spt = tick, uspq / 1e6 / division
        segs.append((tick, sec, spt))
    return division, segs


def time_map(mid_path):
    """Returns a function mapping score positions in quarter notes to seconds."""
    division, segs = midi_tempo_map(mid_path)

    def to_sec(quarters):
        tick = float(quarters) * division
        t, s, spt = next(seg for seg in reversed(segs) if tick >= seg[0])
        return round(s + (tick - t) * spt, 4)
    return to_sec


def parse_part(part):
    """Returns (events, measure_starts, onsets) with positions in quarter notes.

    events: list of (start, duration, lyrics, notes, bar, in_slur) for voice 1 of the part's first
    staff, where lyrics is None for rests and otherwise a list of (number, syllabic, text), notes is
    a list of (midi_pitch, tied_to_next), bar is the measure number, and in_slur tells whether a
    slur started on an earlier note covers this one. onsets holds the start of every note and rest
    in any staff or voice of the part.
    """
    events, measures, slurs, onsets = [], [], set(), set()
    mstart, divisions = Fraction(0), 1
    for measure in part.findall("measure"):
        bar = measure.get("number")
        measures.append(mstart)
        pos = mlen = Fraction(0)
        for el in measure:
            if el.tag == "attributes" and el.find("divisions") is not None:
                divisions = int(el.findtext("divisions"))
            elif el.tag == "backup":
                pos -= Fraction(int(el.findtext("duration")), divisions)
            elif el.tag == "forward":
                pos += Fraction(int(el.findtext("duration")), divisions)
            elif el.tag == "note":
                if el.find("grace") is not None:
                    continue
                dur = Fraction(int(el.findtext("duration")), divisions)
                is_chord = el.find("chord") is not None
                start = pos - dur if is_chord else pos
                if not is_chord:
                    pos += dur
                mlen = max(mlen, pos)
                onsets.add(mstart + start)
                if (el.findtext("voice") or "1") != "1" or (el.findtext("staff") or "1") != "1":
                    continue
                if el.find("rest") is not None:
                    events.append((mstart + start, dur, None, None, bar, bool(slurs)))
                    continue
                pitch = el.find("pitch")
                midi = (int(pitch.findtext("octave")) + 1) * 12 + STEPS[pitch.findtext("step")] + \
                    int(float(pitch.findtext("alter") or 0))
                tied = any(t.get("type") == "start" for t in el.findall("tie"))
                if is_chord:
                    events[-1][3].append((midi, tied))
                else:
                    lyrics = [(int(l.get("number", "1")), l.findtext("syllabic") or "single",
                               "".join("".join(t.itertext()) for t in l.findall("text")).strip())
                              for l in el.findall("lyric")]
                    events.append((mstart + start, dur, lyrics, [(midi, tied)], bar, bool(slurs)))
                for s in el.findall("notations/slur"):
                    (slurs.add if s.get("type") == "start" else slurs.discard)(s.get("number", "1"))
        mstart += mlen
    measures.append(mstart)
    return sorted(events, key=lambda e: e[0]), measures, onsets


def credits(root, mscx):
    """The MusicXML export has no <credit> elements, so the texts of the title frame (the
    first VBox) come from the .mscx; the score's metadata, which is often left at its
    defaults, is the fallback."""
    found = {}
    vbox = re.search(r"<VBox>.*?</VBox>", mscx, re.S)
    for style, text in re.findall(r"<Text>.*?<style>(.*?)</style>.*?<text>(.*?)</text>", vbox[0] if vbox else "", re.S):
        words = html.unescape(re.sub(r"<[^>]*>", "", text)).strip()
        if words and words not in PLACEHOLDERS:
            found.setdefault(style.lower(), words)
    for c in root.findall("identification/creator"):
        if c.text and c.text.strip() not in PLACEHOLDERS:
            found.setdefault(c.get("type"), c.text.strip())
    work_title = (root.findtext("work/work-title") or "").strip()
    title = found.get("title") or (work_title not in PLACEHOLDERS and work_title) or "Untitled"
    by = " · ".join(filter(None, [found.get("composer"), found.get("lyricist") and f"text by {found['lyricist']}"]))
    return title, found.get("subtitle", ""), by


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main():
    xml_path, mid_path, src, out = sys.argv[1:5]
    to_sec = time_map(mid_path)
    root = ET.parse(xml_path).getroot()
    title, subtitle, by = credits(root, next(Path(src).glob("*.mscx")).read_text())
    names = {sp.get("id"): sp.findtext("part-name") for sp in root.findall("part-list/score-part")}
    result = {"title": title, "subtitle": subtitle, "credits": by, "parts": [], "voices": []}
    for part in root.findall("part"):
        name = names[part.get("id")]
        events, measures, _ = parse_part(part)
        if "measures" not in result:
            result["measures"] = [to_sec(m) for m in measures]
        vocal = any(e[2] for e in events)
        result["parts"].append({"name": name, "file": f"audio/{slug(name)}", "vocal": vocal})
        if not vocal:
            continue

        sylls, notes, open_ties, cur_syl, lyric_on_tie = [], [], {}, -1, 0
        warnings, prev = [], ("single", None)

        def warn(bar, msg):
            warnings.append(f"  {name} m{bar}: {msg}")

        for i, (start, dur, lyr, chord, bar, in_slur) in enumerate(events):
            if lyr is None:
                cur_syl = -1
                continue
            if lyr:
                # A syllable lasts until the next rest or next lyric-bearing note.
                end = start + dur
                for s2, d2, l2, *_ in events[i + 1:]:
                    if l2 is None or l2:
                        break
                    end = s2 + d2
                # Only one verse is shown; a few lyrics may have been entered on another verse line.
                verse, syllabic, text = min(lyr)
                if verse != 1:
                    warn(bar, f"'{text}' is on verse line {verse}")
                if prev[0] in ("begin", "middle") and syllabic in ("begin", "single"):
                    warn(bar, f"'{prev[1]}' ({prev[0]}) is followed by '{text}' ({syllabic}), leaving the word open")
                elif prev[0] in ("end", "single") and syllabic in ("middle", "end"):
                    warn(bar, f"'{prev[1]}' ({prev[0]}) is followed by '{text}' ({syllabic}), a word without a beginning")
                if in_slur:
                    warn(bar, f"'{text}' is inside a slur that started on an earlier note")
                prev = (syllabic, text)
                cur_syl = len(sylls)
                sylls.append({"t0": to_sec(start), "t1": to_sec(end), "text": text, "syl": syllabic[0]})
            elif cur_syl < 0:
                warn(bar, f"note after a rest has no lyric (previous lyric '{prev[1]}')")
            ties = {}
            for pitch, tied in chord:
                note = open_ties.pop(pitch, None)
                # A lyric on a tied note starts a new bar; the score probably meant a slur.
                if note is not None and lyr:
                    lyric_on_tie += 1
                    warn(bar, f"'{min(lyr)[2]}' is on the continuation of a tie")
                    note = None
                if note is None or note["end"] != start:
                    note = {"start": start, "p": pitch, "s": cur_syl}
                    notes.append(note)
                note["end"] = start + dur
                if tied:
                    ties[pitch] = note
            open_ties = ties
        result["voices"].append({"name": name, "syllables": sylls, "notes": [
            {"t0": to_sec(n["start"]), "t1": to_sec(n["end"]), "p": n["p"], "s": n["s"]} for n in notes]})
        print(f"{name}: {len(sylls)} syllables, {len(notes)} notes, unsung notes: "
              f"{sum(n['s'] < 0 for n in notes)}, lyrics on tied notes: {lyric_on_tie}", file=sys.stderr)
        for w in warnings:
            print(w, file=sys.stderr)
    json.dump(result, open(out, "w"), indent=0)


if __name__ == "__main__":
    main()
