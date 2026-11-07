"""Extract timed notes and lyric syllables per vocal part from a MusicXML export.

Usage: extract.py score.musicxml score.mid src_dir out.json

Both input files must be exported by MuseScore from the same score; src_dir holds the
unpacked .mscz, whose title frame gives the title and credits. Timing comes from the
MIDI file, which is what the page plays, so the tempo map (fermatas, ritardandos, ...)
matches the music. Score positions are assumed to map 1:1 to MIDI ticks, i.e. the score
has no repeats, except at pauses (after a breath mark or caesura, or at a section break),
for which MuseScore's MIDI export inserts a bar of ticks (see time_map). Each part gets the
MIDI channels it plays on.
"""

import bisect, html, json, re, struct, sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PLACEHOLDERS = {"Untitled score", "Composer / arranger", "Subtitle", "Lyricist"}
SMALL_WORDS = set("a an and as at but by for in nor of on or the to with".split())


def title_case(text):
    """Title frames are often set in capitals, which the page shouldn't shout; text in
    mixed case is left as written. Roman numerals stay in capitals."""
    if not text.isupper():
        return text

    def word(m):
        w = m[0]
        if re.fullmatch(r"X{0,3}(IX|IV|V?I{0,3})", w):
            return w
        if m.start() > 0 and w.lower() in SMALL_WORDS:
            return w.lower()
        return w[0] + w[1:].lower()

    return re.sub(r"[^\W\d_][\w']*", word, text)


def varlen(data, p):
    value = 0
    while True:
        b = data[p]
        p += 1
        value = (value << 7) | (b & 0x7F)
        if b < 0x80:
            return value, p


def read_midi(path):
    """Returns (division, [(tick, seconds, seconds_per_tick)], tracks, note_ticks), where tracks
    holds the set of channels that each track plays notes on, and note_ticks the sorted ticks of
    all note-ons."""
    data = open(path, "rb").read()
    assert data[:4] == b"MThd"
    _, _, ntracks, division = struct.unpack(">IHHH", data[4:14])
    pos, tempos, tracks, note_ticks = 14, [], [], []
    for _ in range(ntracks):
        assert data[pos : pos + 4] == b"MTrk"
        (length,) = struct.unpack(">I", data[pos + 4 : pos + 8])
        p, end, tick, status = pos + 8, pos + 8 + length, 0, 0
        tracks.append(set())
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
                    tempos.append((tick, int.from_bytes(data[p : p + 3], "big")))
                p += ln
            elif status in (0xF0, 0xF7):
                ln, p = varlen(data, p)
                p += ln
            else:
                if status & 0xF0 == 0x90 and data[p + 1] > 0:
                    tracks[-1].add(status & 0x0F)
                    note_ticks.append(tick)
                p += 1 if (status & 0xF0) in (0xC0, 0xD0) else 2
        pos = end
    segs, sec, last_tick, spt = [(0, 0.0, 0.5 / division)], 0.0, 0, 0.5 / division
    for tick, uspq in sorted(tempos):
        sec += (tick - last_tick) * spt
        last_tick, spt = tick, uspq / 1e6 / division
        segs.append((tick, sec, spt))
    return division, segs, tracks, sorted(note_ticks)


def pause_places(root):
    """Where MuseScore may pause, as {position in quarter notes: quarter notes in a bar there}:
    after a note with a breath mark or caesura, and at every barline (a section break). The bar
    is a full bar of the time signature, which is how many ticks a pause adds to the MIDI."""
    places = {}
    for part in root.findall("part"):
        mstart, divisions, bar = Fraction(0), 1, Fraction(4)
        for measure in part.findall("measure"):
            pos = mlen = Fraction(0)
            for el in measure:
                if el.tag == "attributes":
                    divisions = int(el.findtext("divisions") or divisions)
                    if (t := el.find("time")) is not None:
                        beats = sum(int(b) for b in t.findtext("beats").split("+"))
                        bar = Fraction(4 * beats, int(t.findtext("beat-type")))
                    if pos == 0:
                        places[mstart] = bar
                elif el.tag == "backup":
                    pos -= Fraction(int(el.findtext("duration")), divisions)
                elif el.tag == "forward":
                    pos += Fraction(int(el.findtext("duration")), divisions)
                elif el.tag == "note" and el.find("grace") is None:
                    if el.find("chord") is None:
                        pos += Fraction(int(el.findtext("duration")), divisions)
                    if el.find("notations/articulations/breath-mark") is not None or (
                        el.find("notations/articulations/caesura") is not None
                    ):
                        places[mstart + pos] = bar
                mlen = max(mlen, pos)
            places.setdefault(mstart, bar)
            mstart += mlen
        places.setdefault(mstart, bar)
    return places


def time_map(mid_path, root, mscx):
    """Returns a function mapping score positions in quarter notes to seconds.

    MuseScore's MIDI export makes a pause a bar of extra ticks at its position (PauseMap in
    MuseScore's src/engraving/compat/midi/pausemap.cpp): a tempo change there that makes the bar
    last the pause, and one back at its end, with no note starting in between. A pause is found
    where pause_places() allows one, the MIDI has that pattern, and the bar lasts one of the
    pauses in the .mscx (a fermata over a bar's rest makes the same tempo changes)."""
    division, segs, _, note_ticks = read_midi(mid_path)
    pauses = {float(p) for p in re.findall(r"<pause>([^<]+)</pause>", mscx)} - {0.0}
    tempo_ticks = sorted({seg[0] for seg in segs[1:]})

    def seconds(tick):
        t, s, spt = next(seg for seg in reversed(segs) if tick >= seg[0])
        return s + (tick - t) * spt

    inserted, shift = [], 0  # [(position, extra ticks)]
    for q, bar in sorted(pause_places(root).items()) if pauses else ():
        t, length = q * division + shift, bar * division
        if t.denominator != 1 or length.denominator != 1:
            continue
        t, length = int(t), int(length)
        i = bisect.bisect_left(tempo_ticks, t)
        if tempo_ticks[i : i + 2] != [t, t + length]:
            continue
        if bisect.bisect_left(note_ticks, t) != bisect.bisect_left(note_ticks, t + length):
            continue
        if any(abs(seconds(t + length) - seconds(t) - p) < 0.002 for p in pauses):
            inserted.append((q, length))
            shift += length

    def to_sec(quarters):
        tick = float(quarters) * division + sum(n for q, n in inserted if q <= quarters)
        return round(seconds(tick), 4)

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
                midi = (
                    (int(pitch.findtext("octave")) + 1) * 12
                    + STEPS[pitch.findtext("step")]
                    + int(float(pitch.findtext("alter") or 0))
                )
                tied = any(t.get("type") == "start" for t in el.findall("tie"))
                if is_chord:
                    events[-1][3].append((midi, tied))
                else:
                    lyrics = [
                        (
                            int(l.get("number", "1")),
                            l.findtext("syllabic") or "single",
                            "".join("".join(t.itertext()) for t in l.findall("text")).strip(),
                        )
                        for l in el.findall("lyric")
                    ]
                    events.append((mstart + start, dur, lyrics, [(midi, tied)], bar, bool(slurs)))
                for s in el.findall("notations/slur"):
                    # Dashed or dotted slurs mark phrasing ("don't breathe"), not melismas.
                    if s.get("line-type", "solid") != "solid":
                        continue
                    (slurs.add if s.get("type") == "start" else slurs.discard)(s.get("number", "1"))
        mstart += mlen
    measures.append(mstart)
    return sorted(events, key=lambda e: e[0]), measures, onsets


def part_channels(root, mid_path):
    """The MIDI channels of each part, by part id. MuseScore writes one track per staff, in score
    order, and a part plays on all channels of its tracks: an instrument can have several, such as
    a cello's arco, pizzicato and tremolo. The MusicXML names only each part's first channel, which
    checks the mapping."""
    tracks = read_midi(mid_path)[2]
    channels, i = {}, 0
    for sp, part in zip(root.findall("part-list/score-part"), root.findall("part")):
        staves = int(part.findtext("measure/attributes/staves") or 1)
        channels[sp.get("id")] = sorted(set().union(*tracks[i : i + staves]))
        i += staves
        first = int(sp.findtext("midi-instrument/midi-channel")) - 1
        if channels[sp.get("id")] and first not in channels[sp.get("id")]:
            sys.exit(
                f"{sp.findtext('part-name')}: its tracks play on channels "
                f"{channels[sp.get('id')]}, not on its MusicXML channel {first}"
            )
    if i != len(tracks):
        sys.exit(f"the score has {i} staves, but the MIDI file has {len(tracks)} tracks")
    return channels


def credits(root, mscx):
    """The MusicXML export has no <credit> elements, so the texts of the title frame (the
    first VBox) come from the .mscx; the score's metadata, which is often left at its
    defaults, is the fallback."""
    found = {}
    vbox = re.search(r"<VBox>.*?</VBox>", mscx, re.S)
    for style, text in re.findall(
        r"<Text>.*?<style>(.*?)</style>.*?<text>(.*?)</text>", vbox[0] if vbox else "", re.S
    ):
        words = html.unescape(re.sub(r"<[^>]*>", "", text)).strip()
        if words and words not in PLACEHOLDERS:
            found.setdefault(style.lower(), title_case(words))
    for c in root.findall("identification/creator"):
        if c.text and c.text.strip() not in PLACEHOLDERS:
            found.setdefault(c.get("type"), c.text.strip())
    work_title = (root.findtext("work/work-title") or "").strip()
    title = found.get("title") or (work_title not in PLACEHOLDERS and work_title) or "Untitled"
    by = " · ".join(
        filter(
            None, [found.get("composer"), found.get("lyricist") and f"text by {found['lyricist']}"]
        )
    )
    return title, found.get("subtitle", ""), by


def main():
    xml_path, mid_path, src, out = sys.argv[1:5]
    root = ET.parse(xml_path).getroot()
    mscx = next(Path(src).glob("*.mscx")).read_text()
    to_sec = time_map(mid_path, root, mscx)
    title, subtitle, by = credits(root, mscx)
    names = {sp.get("id"): sp.findtext("part-name") for sp in root.findall("part-list/score-part")}
    channels = part_channels(root, mid_path)
    result = {"title": title, "subtitle": subtitle, "credits": by, "parts": [], "voices": []}
    for part in root.findall("part"):
        name = names[part.get("id")]
        events, measures, _ = parse_part(part)
        if "measures" not in result:
            result["measures"] = [to_sec(m) for m in measures]
        vocal = any(e[2] for e in events)
        result["parts"].append({"name": name, "channels": channels[part.get("id")], "vocal": vocal})
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
                for s2, d2, l2, *_ in events[i + 1 :]:
                    if l2 is None or l2:
                        break
                    end = s2 + d2
                # Only one verse is shown; a few lyrics may have been entered on another verse line.
                verse, syllabic, text = min(lyr)
                if verse != 1:
                    warn(bar, f"'{text}' is on verse line {verse}")
                if prev[0] in ("begin", "middle") and syllabic in ("begin", "single"):
                    warn(
                        bar,
                        f"'{prev[1]}' ({prev[0]}) is followed by '{text}' ({syllabic}), leaving the word open",
                    )
                elif prev[0] in ("end", "single") and syllabic in ("middle", "end"):
                    warn(
                        bar,
                        f"'{prev[1]}' ({prev[0]}) is followed by '{text}' ({syllabic}), a word without a beginning",
                    )
                if in_slur:
                    warn(bar, f"'{text}' is inside a slur that started on an earlier note")
                prev = (syllabic, text)
                cur_syl = len(sylls)
                sylls.append(
                    {"t0": to_sec(start), "t1": to_sec(end), "text": text, "syl": syllabic[0]}
                )
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
        result["voices"].append(
            {
                "name": name,
                "syllables": sylls,
                "notes": [
                    {"t0": to_sec(n["start"]), "t1": to_sec(n["end"]), "p": n["p"], "s": n["s"]}
                    for n in notes
                ],
            }
        )
        print(
            f"{name}: {len(sylls)} syllables, {len(notes)} notes, unsung notes: "
            f"{sum(n['s'] < 0 for n in notes)}, lyrics on tied notes: {lyric_on_tie}",
            file=sys.stderr,
        )
        for w in warnings:
            print(w, file=sys.stderr)
    json.dump(result, open(out, "w"), indent=0)


if __name__ == "__main__":
    main()
