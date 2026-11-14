"""Give each syllable of a piece's vocal parts the vowel it is sung on, from the lyrics.

Usage: vowels.py media/<season>/<slug>

Writes `v` into each syllable of the piece's piece.json: one of the vowels of
site/src/lib/vowels.ts as its IPA symbol, or a diphthong's two as a list, and none for a
syllable without a vowel, such as a hummed "mm". The piece's entry in its season's
pieces.json can say:

- "languages": [[phrase, language], ...]: the language from each syllable at which a part's
  text continues with `phrase` on (matched as for "hues", "" being the start; a part without
  the phrase switches at the times of the first part that has it). English by default. Languages: "en" (from
  CMUdict), "la" (Latin, as sung in church), "fr" (French), and "vocalise" (syllables such
  as "ah", "doo", "mm" sung as spelled).
- "vowels": {word: vowels}: the vowels of a word, in any part and language, one per
  syllable that the score gives it, separated by spaces: a vowel, a diphthong's two, or "-"
  for none. "every": "ɛ i".

Prints the words that it didn't find as they are in the dictionary, with how it read them,
and the words whose syllables in the score it fitted to the dictionary's.
"""

import gzip, json, re, sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
VOWELS = set(re.findall(r"ipa: '(.)'", (TOOLS / "../site/src/lib/vowels.ts").read_text()))

# CMUdict's vowels, as sung: diphthongs as their two vowels. The schwa (AH0) is sung as "uh".
ARPABET = {
    "AA": "a", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ",
    "ER": "ɜ", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ",
    "UW": "u",
}  # fmt: skip


def load_dictionary():
    """CMUdict: per word, its pronunciations, each as its vowels, [(arpabet, stress)]."""
    d = {}
    with gzip.open(TOOLS / "cmudict/cmudict.dict.gz", "rt", encoding="utf-8") as f:
        for line in f:
            word, *phones = line.split("#")[0].split()
            vowels = [(p[:-1], int(p[-1])) for p in phones if p[-1].isdigit()]
            d.setdefault(re.sub(r"\(\d+\)$", "", word), []).append(vowels)
    return d


def fit(vowels, n):
    """`vowels` [(arpabet, stress)] made `n` long: without unstressed vowels, schwas first,
    from the end, or with a diphthong split, or the last vowel repeated."""
    vowels = list(vowels)
    for unstressed in (("AH", "ER"), tuple(ARPABET)):
        for i in reversed(range(len(vowels))):
            if len(vowels) > n and vowels[i][1] == 0 and vowels[i][0] in unstressed:
                del vowels[i]
    sung = [ARPABET[a] for a, _ in vowels[:n]]
    for i in reversed(range(len(sung))):
        if len(sung) < n and len(sung[i]) == 2:
            sung[i : i + 1] = list(sung[i])
    return sung + sung[-1:] * (n - len(sung)) if sung else [""] * n


# English spelling, for words that the dictionary doesn't have: groups of vowel letters.
SPELLING = [
    ("ee|ea|ie", "i"), ("oo", "u"), ("ou|ow", "aʊ"), ("ai|ay|ei|ey", "eɪ"), ("oa", "oʊ"),
    ("oi|oy", "ɔɪ"), ("au|aw", "ɔ"), ("a", "æ"), ("e", "ɛ"), ("i", "ɪ"), ("o", "ɔ"),
    ("u", "ʌ"), ("y", "i"),
]  # fmt: skip


def spelled(word):
    """The vowels of an English word as spelled, without a silent final e."""
    word = (
        re.sub(r"(?<=[^aeiouy])e$", "", word) if re.search(r"[aeiouy].*[^aeiouy]e$", word) else word
    )
    pattern = "|".join(f"(?:{p})" for p, _ in SPELLING)
    out = []
    for m in re.finditer(pattern, re.sub(r"^y", "", word)):
        out.append(next(v for p, v in SPELLING if re.fullmatch(p, m.group())))
    return out


class English:
    def __init__(self):
        self.dictionary = load_dictionary()

    def known(self, word):
        """The pronunciations of a word, also of archaic spellings: "whisper'd", "glist'ning",
        "crooneth", and of compounds of two words: "hearthfire". None if unknown."""
        d = self.dictionary
        if word in d:
            return d[word]
        for old, new in ((r"'d$", "ed"), (r"'n", "en"), (r"'st$", "est")):
            if re.search(old, word) and re.sub(old, new, word) in d:
                return d[re.sub(old, new, word)]
        m = re.fullmatch(r"(.+?)(s|es|d|ed|ing|eth|est)", word)
        if m and (stem := d.get(m[1]) or d.get(m[1] + "e")):
            # The ending's vowel, if it has one: "-ed" after t or d, as in "wanted".
            vowel = {"ing": "IH", "eth": "EH", "est": "EH"}.get(m[2])
            if m[2] == "ed" and m[1][-1] in "td":
                vowel = "IH"
            return [p + ([(vowel, 0)] if vowel else []) for p in stem]
        if word.startswith("un") and (rest := self.known(word[2:])):
            return [[("AH", 0)] + p for p in rest]
        # Compounds of words of at least three letters, the first as long as can be.
        for i in range(len(word) - 3, 2, -1):
            if word[:i] in d and (rest := self.known(word[i:])):
                return [d[word[:i]][0] + p for p in rest]
        return None

    def word(self, word, n, report):
        """The vowels of a word sung on `n` syllables."""
        word = word.replace("-", "")
        found = self.known(word)
        if found is None:
            vowels = spelled(word)
            if vowels:
                report.guessed(word, " ".join(vowels))
            return (vowels[:n] + vowels[-1:] * (n - len(vowels))) if vowels else [""] * n
        if not any(found):
            return [""] * n  # a word without vowels, such as "mm" or "sh"
        if word not in self.dictionary:
            report.read(word, found[0])
        if word in ("a", "the"):
            return ["ʌ"] * n
        # Of the pronunciations that fit, the fullest: "and" is sung æ, not as a schwa.
        exact = sorted((p for p in found if len(p) == n), key=lambda p: sum(s == 0 for _, s in p))
        if exact:
            return [ARPABET[a] for a, _ in exact[0]]
        best = min(found, key=lambda p: abs(len(p) - n))
        report.fitted(word, n, best)
        return fit(best, n)


def latin(text):
    """A Latin syllable's vowel, as sung in church: ae and oe as e, au as a diphthong, u after
    q, and after ng before a vowel, a glide."""
    s = re.sub(r"[^a-zæœ]", "", strip_accents(text.lower()))
    s = re.sub(r"(?<=q)u(?=[aeiouy])|(?<=ng)u(?=[aeiouy])", "", s).replace("j", "")
    s = re.sub(r"ae|oe|æ|œ", "ɛ", s).replace("y", "i")
    vowels = re.findall(r"au|[aeiouɛ]", s)
    sung = {"a": "a", "e": "ɛ", "i": "i", "o": "ɔ", "u": "u", "ɛ": "ɛ", "au": "au"}
    vowels = [sung[v] for v in vowels]
    return "".join(vowels[:2]) if vowels else ""


def french(text, last):
    """A French syllable's vowel; a nasal vowel is its oral one. `last` is whether the syllable
    ends a word of several, where a lone e is the sung schwa, near ö."""
    s = re.sub(r"[^a-zàâæçéèêëîïôœùûüÿ]", "", text.lower())
    for pattern, v in [
        (r"eau|au", "o"), (r"oi", "a"), (r"o[uù]", "u"), (r"[eœ]u", "ø"), (r"[ae]i", "ɛ"),
        (r"[ae][nm](?![aeiouyn])", "a"), (r"o[nm](?![aeiouyn])", "o"),
        (r"[iy][nm](?![aeiouyn])|[ae]in", "ɛ"), (r"u[nm](?![aeiouyn])", "ø"),
        (r"e[zr]$", "e"), (r"é", "e"), (r"[èêë]", "ɛ"), (r"e(?=s?$)" if last else r"(?!)", "ø"),
        (r"e(?=[^aeiouy]+$)", "ɛ"), (r"e", "ø"), (r"[aàâ]", "a"), (r"[ôo]", "ɔ"),
        (r"[uûü]", "y"), (r"[iîïy]", "i"),
    ]:  # fmt: skip
        if re.search(pattern, s):
            return v
    return ""


def vocalise(text):
    """A syllable sung as spelled: "ah", "doo", "eh"; consonants alone ("mm", "sh") have none."""
    s = re.sub(r"[^a-z]", "", text.lower())
    groups = re.findall(r"aa|ah|ee|oo|ou|eh|oh|[aeiouy]", s)
    sung = {"aa": "a", "ah": "a", "a": "a", "ee": "i", "i": "i", "y": "i", "oo": "u", "ou": "u",
            "u": "u", "eh": "ɛ", "e": "ɛ", "oh": "o", "o": "o"}  # fmt: skip
    return "".join(sung[g] for g in groups[:2])


def strip_accents(s):
    return s.translate(str.maketrans("áàâäéèêëíìîïóòôöúùûü", "aaaaeeeeiiiioooouuuu"))


def starts_word(sylls, i):
    """As startsWord() in site/src/lib/lyrics.ts."""
    return i == 0 or sylls[i - 1]["syl"] in "se"


def phrase_indices(sylls, phrase):
    """As phraseTime() in site/src/lib/lyrics.ts, but the indices of every syllable at which the
    text continues with `phrase`."""
    before, after = phrase.split("|") if "|" in phrase else ("", phrase)
    text, starts = "", []
    for i, s in enumerate(sylls):
        if i > 0 and starts_word(sylls, i):
            text += " "
        starts.append(len(text))
        text += s["text"]
    return [
        i
        for i, start in enumerate(starts)
        if text.startswith(after, start) and text[:start].endswith(before)
    ]


def word_text(sylls):
    w = "".join(s["text"] for s in sylls).lower().replace("’", "'")
    return re.sub(r"[^\w'-]", "", w).strip("'-")


class Report:
    def __init__(self):
        self.lines = {}

    def note(self, kind, word, text):
        self.lines.setdefault((kind, word), text)

    def read(self, word, vowels):
        self.note("read", word, " ".join(ARPABET[a] for a, _ in vowels))

    def guessed(self, word, vowels):
        self.note("guessed from spelling", word, vowels)

    def fitted(self, word, n, vowels):
        self.note("fitted", word, f"{len(vowels)} vowels in the dictionary, {n} syllables sung")

    def print(self):
        for kind in ("read", "guessed from spelling", "fitted"):
            words = [(w, t) for (k, w), t in self.lines.items() if k == kind]
            if words:
                print(f"  {kind}: " + ", ".join(f"{w} ({t})" for w, t in sorted(words)))


def main(piece_dir):
    piece_dir = Path(piece_dir)
    piece_path = piece_dir / "piece.json"
    piece = json.loads(piece_path.read_text())
    season = piece_dir.parent / "pieces.json"
    entry = next(
        (e for e in json.loads(season.read_text())["pieces"] if e["slug"] == piece_dir.name),
        {},
    ) if season.exists() else {}  # fmt: skip
    languages = entry.get("languages", [["", "en"]])
    overrides = {}
    for word, spec in entry.get("vowels", {}).items():
        sylls = [[] if v == "-" else list(v) for v in spec.split()]
        bad = {c for v in sylls for c in v} - VOWELS
        if bad or any(len(v) > 2 for v in sylls):
            sys.exit(f"{season}: vowels of {word!r}: {spec!r} isn't vowels of vowels.ts")
        overrides[word.lower()] = ["".join(v) for v in sylls]

    english = None
    report = Report()
    voices = piece["voices"]

    def at(sylls, phrase):
        return ([0] if sylls else []) if phrase == "" else phrase_indices(sylls, phrase)

    # The times of each phrase in the first part that sings it, for the parts that don't.
    switch_times = []
    for phrase, lang in languages:
        sung = next((v["syllables"] for v in voices if at(v["syllables"], phrase)), None)
        if sung is None:
            print(f"  language {lang!r}: no part sings {phrase!r}")
        switch_times.append([sung[k]["t0"] for k in at(sung, phrase)] if sung else [])

    for voice in voices:
        sylls = voice["syllables"]
        # Each syllable's language: that of the last switch at or before it.
        switches = []
        for (phrase, lang), times in zip(languages, switch_times):
            starts = at(sylls, phrase) or [
                next((k for k, s in enumerate(sylls) if s["t0"] >= t), len(sylls)) for t in times
            ]
            switches += [(k, lang) for k in starts]
        switches.sort(key=lambda s: s[0])
        language, current = [], "en"
        for k in range(len(sylls)):
            while switches and switches[0][0] <= k:
                current = switches.pop(0)[1]
            language.append(current)

        i = 0
        while i < len(sylls):
            j = i + 1
            while j < len(sylls) and not starts_word(sylls, j):
                j += 1
            word, n, lang = word_text(sylls[i:j]), j - i, language[i]
            if word in overrides:
                vowels = overrides[word]
                if len(vowels) != n:
                    print(f"  vowels of {word!r}: {len(vowels)} given, {n} syllables sung")
                    vowels = (vowels + vowels[-1:] * n)[:n]
            elif lang == "en":
                english = english or English()
                vowels = english.word(word, n, report) if word else [""] * n
            elif lang == "la":
                vowels = [latin(s["text"]) for s in sylls[i:j]]
            elif lang == "fr":
                vowels = [
                    french(s["text"], n > 1 and k == j - 1) for k, s in enumerate(sylls[i:j], i)
                ]
            elif lang == "vocalise":
                vowels = [vocalise(s["text"]) for s in sylls[i:j]]
            else:
                sys.exit(f"{season}: unknown language {lang!r}")
            for s, v in zip(sylls[i:j], vowels):
                s.pop("v", None)
                if v:
                    s["v"] = v if len(v) == 1 else list(v)
            i = j

    print(f"{piece_dir}: vowels of " + ", ".join(
        f"{v['name']} {sum('v' in s for s in v['syllables'])}/{len(v['syllables'])}"
        for v in voices
    ))  # fmt: skip
    report.print()
    piece_path.write_text(json.dumps(piece, indent=0))


if __name__ == "__main__":
    main(sys.argv[1])
