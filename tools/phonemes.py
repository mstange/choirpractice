"""Give each syllable of a piece's vocal parts the sounds it is sung on, from the lyrics.

Usage: phonemes.py media/<season>/<slug>

Writes `p` into each syllable of the piece's piece.json: its phonemes, one character each, as
site/src/lib/vowels.ts lists them: its vowels (none, one, or a diphthong's two) and the
consonants around them, such as "kwin" for "queen". A syllable without any, such as one of a
word that it doesn't know how to read, has none. The piece's entry in its season's pieces.json
can say:

- "languages": [[phrase, language], ...]: the language from each syllable at which a part's
  text continues with `phrase` on (matched as for "hues", "" being the start; a part without
  the phrase switches at the times of the first part that has it). English by default. Languages: "en" (from
  CMUdict), "la" (Latin, as sung in church), "fr" (French), and "vocalise" (syllables such
  as "ah", "doo", "mm" sung as spelled).
- "phonemes": {word: phonemes}: the phonemes of a word, in any part and language, those of
  each syllable that the score gives it, separated by spaces, "-" for none. "every": "ɛv ri".

Prints the words that it didn't find as they are in the dictionary, with how it read them,
and the words whose syllables in the score it fitted to the dictionary's.
"""

import gzip, json, re, sys
from collections import Counter
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
_VOWELS_TS = (TOOLS / "../site/src/lib/vowels.ts").read_text()
VOWELS = set(re.findall(r"ipa: '(.)'", _VOWELS_TS))
GLIDES = set(re.findall(r"(\S): '.'", re.search(r"GLIDES.*= \{(.*)\}", _VOWELS_TS)[1]))
PHONEMES = VOWELS | GLIDES | set(re.search(r"CONSONANTS = '(.*)'", _VOWELS_TS)[1])

# CMUdict's vowels, as sung: diphthongs as their two vowels. The schwa (AH0) is sung as "uh".
ARPABET = {
    "AA": "a", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ",
    "ER": "ɜ", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ",
    "UW": "u",
    "B": "b", "CH": "ʧ", "D": "d", "DH": "ð", "F": "f", "G": "g", "HH": "h", "JH": "ʤ",
    "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "r", "S": "s",
    "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}  # fmt: skip


def load_dictionary():
    """CMUdict: per word, its pronunciations, each as its phones, [(ipa, stress)], with a stress
    of None for consonants."""
    d = {}
    with gzip.open(TOOLS / "cmudict/cmudict.dict.gz", "rt", encoding="utf-8") as f:
        for line in f:
            word, *phones = line.split("#")[0].split()
            pron = [
                (ARPABET[p[:-1]], int(p[-1])) if p[-1].isdigit() else (ARPABET[p], None)
                for p in phones
            ]
            d.setdefault(re.sub(r"\(\d+\)$", "", word), []).append(pron)
    return d


def text(pron):
    return "".join(p for p, _ in pron)


def count(pron):
    return sum(s is not None for _, s in pron)


def fit(pron, n):
    """`pron` made to have `n` vowels: without unstressed vowels, schwas first, from the end, or
    else without its last vowels; or with a diphthong split, or the last vowel repeated."""
    pron = list(pron)
    for unstressed in (("ʌ", "ɜ"), None):
        for i in reversed(range(len(pron))):
            v, s = pron[i]
            if count(pron) > n and s == 0 and (unstressed is None or v in unstressed):
                del pron[i]
    for i in reversed(range(len(pron))):
        if count(pron) > n and pron[i][1] is not None:
            del pron[i]
    for i in reversed(range(len(pron))):
        v, s = pron[i]
        if count(pron) < n and s is not None and len(v) == 2:
            pron[i : i + 1] = [(v[0], s), (v[1], s)]
    vowels = [i for i, (_, s) in enumerate(pron) if s is not None]
    if vowels:
        pron[vowels[-1] + 1 : vowels[-1] + 1] = [pron[vowels[-1]]] * (n - count(pron))
    return pron


def syllabify(pron, onsets):
    """The phonemes of each syllable of `pron`, one per vowel: of the consonants between two
    vowels, the second syllable gets the longest run at the end that English words start with."""
    sylls, cluster = [], ""
    for p, s in pron:
        if s is None:
            cluster += p
            continue
        if sylls:
            k = next(k for k in range(len(cluster) + 1) if cluster[k:] in onsets)
            sylls[-1] += cluster[:k]
            cluster = cluster[k:]
        sylls.append(cluster + p)
        cluster = ""
    if sylls:
        sylls[-1] += cluster
    return sylls


# English spelling, for words that the dictionary doesn't have: a y before a vowel, groups of
# vowel letters, then consonants.
SPELLING = [
    ("y(?=[aeiou])", "j"),
    ("ee|ea|ie", "i"), ("oo", "u"), ("ou|ow", "aʊ"), ("ai|ay|ei|ey", "eɪ"), ("oa", "oʊ"),
    ("oi|oy", "ɔɪ"), ("au|aw", "ɔ"), ("a", "æ"), ("e", "ɛ"), ("i", "ɪ"), ("o", "ɔ"),
    ("u", "ʌ"), ("y", "i"),
    ("tch|ch", "ʧ"), ("sh", "ʃ"), ("th", "θ"), ("ph", "f"), ("wh", "w"), ("ck", "k"),
    ("ng", "ŋ"), ("qu", "kw"), ("x", "ks"), ("c(?=[eiy])", "s"), ("c", "k"), ("j", "ʤ"),
    ("[bdfghklmnprstvwz]", None),
]  # fmt: skip


def spelled(word):
    """An English word's phones as spelled, without a silent final e, each vowel stressed."""
    word = (
        re.sub(r"(?<=[^aeiouy])e$", "", word) if re.search(r"[aeiouy].*[^aeiouy]e$", word) else word
    )
    pattern = "|".join(f"({p})" for p, _ in SPELLING)
    pron = []
    for m in re.finditer(pattern, word):
        p = SPELLING[m.lastindex - 1][1] or m.group()
        if not (pron and pron[-1] == (p, None)):  # a doubled consonant
            pron += [(p, 1)] if p[0] in VOWELS else [(c, None) for c in p]
    return pron


VOICELESS, SIBILANTS = set("ptkfθ"), set("szʃʒʧʤ")


def ending(suffix, last):
    """The phones of an English ending after a stem whose last phone is `last`."""
    if suffix in ("s", "es"):
        return (
            [("ɪ", 0), ("z", None)]
            if last in SIBILANTS
            else [("s" if last in VOICELESS else "z", None)]
        )
    if suffix in ("d", "ed"):
        return (
            [("ɪ", 0), ("d", None)] if last in "td" else [("t" if last in VOICELESS else "d", None)]
        )
    return {"ing": [("ɪ", 0), ("ŋ", None)], "eth": [("ɛ", 0), ("θ", None)],
            "est": [("ɛ", 0), ("s", None), ("t", None)]}[suffix]  # fmt: skip


class English:
    def __init__(self):
        self.dictionary = load_dictionary()
        # The consonants that English words start with, those that enough of them do.
        starts = Counter(
            text(p[: next((i for i, (_, s) in enumerate(p) if s is not None), len(p))])
            for prons in self.dictionary.values()
            for p in prons
        )
        self.onsets = {o for o, n in starts.items() if n >= 30} | {""}

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
            return [p + ending(m[2], p[-1][0]) for p in stem]
        if word.startswith("un") and (rest := self.known(word[2:])):
            return [[("ʌ", 0), ("n", None)] + p for p in rest]
        # Compounds of words of at least three letters, the first as long as can be.
        for i in range(len(word) - 3, 2, -1):
            if word[:i] in d and (rest := self.known(word[i:])):
                return [d[word[:i]][0] + p for p in rest]
        return None

    def word(self, word, n, report):
        """The phonemes of each of the `n` syllables that a word is sung on."""
        word = word.replace("-", "")
        found = self.known(word)
        if found is None:
            pron = spelled(word)
            if count(pron):
                report.guessed(word, text(pron))
        else:
            if word not in self.dictionary:
                report.read(word, text(found[0]))
            # Of the pronunciations that fit, the fullest: "and" is sung æ, not as a schwa.
            exact = sorted(
                (p for p in found if count(p) == n), key=lambda p: sum(s == 0 for _, s in p)
            )
            pron = exact[0] if exact else min(found, key=lambda p: abs(count(p) - n))
            if not exact and count(pron):
                report.fitted(word, n, count(pron))
            if word in ("a", "the"):
                pron = [("ʌ", 1) if s is not None else (p, s) for p, s in pron]
        if not count(pron):
            return [text(pron)] + [""] * (n - 1)  # a word without vowels, such as "mm" or "sh"
        return syllabify(fit(pron, n), self.onsets)


def collapse(s):
    """Without doubled consonants."""
    return re.sub(r"(.)\1+", lambda m: m[0] if m[1] in VOWELS else m[1], s)


LATIN = str.maketrans({"J": "j", "W": "w", "T": "ʦ", "N": "ɲ", "S": "ʃ", "C": "ʧ", "G": "ʤ",
                       "Z": "ʣ", "E": "ɛ", "e": "ɛ", "o": "ɔ", "y": "i", "h": None})  # fmt: skip
FRONT = r"(?=[eiyE])"


def latin(texts):
    """The phonemes of the syllables of a Latin word, as sung in church: ae and oe as e, au as a
    diphthong, c and g before e and i as in Italian, an i before a vowel at the start of a
    syllable and the u of qu, and of ngu, before a vowel as glides."""
    raw = [re.sub(r"[^a-z]", "", strip_accents(t.lower())) for t in texts]
    raw = [
        s.replace("æ", "ae").replace("œ", "oe").replace("ae", "E").replace("oe", "E") for s in raw
    ]
    out = []
    for k, s in enumerate(raw):
        prev, next_ = raw[k - 1] if k else "", raw[k + 1] if k + 1 < len(raw) else ""
        soft_next = re.match(r"c[eiyE]", next_)
        s = re.sub(r"^[ij](?=[aeiouE])", "J", s).replace("j", "J")
        s = re.sub(r"qu(?=[aeiouE])", "kW", s)
        if prev.endswith("n"):
            s = re.sub(r"^gu(?=[aeiouE])", "gW", s)
        s = re.sub(r"ngu(?=[aeiouE])", "ngW", s)
        # ti before a vowel, not after s, t or x: "gratia".
        if re.search(r"ti$", s) and next_[:1] in tuple("aeiouE") and next_:
            if not re.search(r"[stx]ti$", s) and not (s == "ti" and prev[-1:] in tuple("stx")):
                s = s[:-2] + "Ti"
        s = re.sub(r"(?<![stx])ti(?=[aeouE])", "Ti", s)
        if s.startswith("h") and prev[-1:] in tuple("aeiouyE") and prev:
            s = "k" + s[1:]  # "mihi", "nihil"
        s = s.replace("ch", "k").replace("ph", "f").replace("th", "t")
        s = s.replace("gn", "N")
        if prev.endswith("g") and s.startswith("n"):
            s = "N" + s[1:]
        if s.endswith("g") and next_.startswith("n"):
            s = s[:-1]
        # sc and xc before e and i: "descendit", "excelsis", also across syllables.
        s = re.sub(r"sc" + FRONT, "S", s)
        s = re.sub(r"xc" + FRONT, "kS", s)
        if re.match(r"c[eiyE]", s) and prev[-1:] in ("s", "x"):
            s = "S" + s[1:]
        if soft_next and s.endswith("s"):
            s = s[:-1]
        if soft_next and s.endswith("x"):
            s = s[:-1] + "k"
        s = re.sub(r"cc" + FRONT, "tC", s)
        s = re.sub(r"c" + FRONT, "C", s)
        if soft_next and s.endswith("c"):
            s = s[:-1] + "t"  # "ecce"
        s = re.sub(r"g" + FRONT, "G", s)
        s = s.replace("x", "ks").replace("z", "Z").replace("c", "k").replace("q", "k")
        s = collapse(s.translate(LATIN))
        out.append(at_most_two_vowels(s))
    return out


def at_most_two_vowels(s):
    vowels = [i for i, c in enumerate(s) if c in VOWELS]
    return "".join(c for i, c in enumerate(s) if i not in vowels[2:])


# French vowels, by the first pattern that the syllable has; a nasal vowel is its oral one.
FRENCH_VOWELS = [
    (r"eau|au", "o"), (r"o[uù]", "u"), (r"[eœ]u", "ø"), (r"[ae]i", "ɛ"),
    (r"[ae][nm](?![aeiouyn])", "a"), (r"o[nm](?![aeiouyn])", "o"),
    (r"[iy][nm](?![aeiouyn])|[ae]in", "ɛ"), (r"u[nm](?![aeiouyn])", "ø"),
    (r"e[zr]$", "e"), (r"é", "e"), (r"[èêë]", "ɛ"), (None, "ø"),
    (r"e(?=[^aeiouy]+$)", "ɛ"), (r"e", "ø"), (r"[aàâ]", "a"), (r"[ôo]", "ɔ"),
    (r"[uûü]", "y"), (r"[iîïy]", "i"),
]  # fmt: skip

FRENCH_CONSONANTS = [
    ("ch", "ʃ"), ("gn", "ɲ"), ("ph", "f"), ("th", "t"), ("c?qu", "k"), ("gu(?=[eiéèêy])", "g"),
    ("c(?=[eiéèêy])|ç", "s"), ("c", "k"), ("g(?=[eiéèêy])|j", "ʒ"), ("h", ""), ("x", "ks"),
]  # fmt: skip


def french(texts):
    """The phonemes of the syllables of a French word. A lone e that ends a word of several is
    the sung schwa, near ö. Final consonants other than c, f, l and r are silent, and so is the r
    of a final -er of a word of several syllables."""
    out = []
    for k, t in enumerate(texts):
        s = re.sub(r"[^a-zàâæçéèêëîïôœùûüÿ]", "", t.lower())
        prev = re.sub(r"[^a-zàâæçéèêëîïôœùûüÿ]", "", texts[k - 1].lower()) if k else ""
        last = k == len(texts) - 1
        if last:
            s = re.sub(r"(?<=[aiouéy])(?<![qg]u)es?$", "", s)  # "rue", "joue", "année"
        # Glides: "roi", "oui", "nuit", "bien", "pied", "soleil".
        s = re.sub(r"oin(?![aeiouy])", "win", s)
        s = re.sub(r"o[iy]", "wa", s)
        s = re.sub(r"ou(?=[aiéèy]|e(?!s?$))", "w", s)
        s = re.sub(r"(?<![qg])u(?=[iéèay]|e(?!s?$))", "ɥ", s)
        s = re.sub(r"ien(?![aeiouy])", "Jin", s)
        s = re.sub(r"(?<=.)i(?=[aeoéèu])", "J", s)
        s = re.sub(r"(?<=[aeouœ])ill?e?$|(?<=[aeouœ])ill", "J", s)
        s = re.sub(r"(?<=[aeou])y(?=[aeiou])", "J", s)
        vowel, start, end = "", len(s), len(s)
        for pattern, v in FRENCH_VOWELS:
            pattern = pattern or (r"e(?=s?$)" if last and len(texts) > 1 else r"(?!)")
            if m := re.search(pattern, s):
                vowel, start, end = v, m.start(), m.end()
                break
        onset, coda = s[:start], s[end:]
        if last:
            if vowel == "e" and re.search(r"e[zr]$", s) and len(texts) > 1:
                coda = ""
            coda = re.sub(r"[sxtdpzg]+$", "", coda)
        if k and re.fullmatch(r"s", onset) and prev[-1:] in tuple("aeiouyéè"):
            onset = "z"  # "rose"
        out.append(collapse(french_consonants(onset) + vowel + french_consonants(coda)))
    return out


def french_consonants(s):
    pattern = "|".join(f"({p})" for p, _ in FRENCH_CONSONANTS)
    s = re.sub(pattern, lambda m: FRENCH_CONSONANTS[m.lastindex - 1][1], s)
    return "".join(c for c in s.replace("J", "j") if c in PHONEMES - VOWELS)


VOCALISE = [
    ("aa|ah|a", "a"), ("ee|i", "i"), ("y(?=[aeiou])", "j"), ("y", "i"), ("oo|ou|u", "u"),
    ("eh|e", "ɛ"), ("oh|o", "o"), ("^h(?=[aeiouy])", "h"), ("h", ""), ("sh", "ʃ"),
    ("ng", "ŋ"), ("ch", "ʧ"), ("th", "θ"), ("[ckq]", "k"), ("j", "ʤ"), ("x", "ks"),
    ("[bdfglmnprstvwz]", None),
]  # fmt: skip


def vocalise(text):
    """A syllable sung as spelled: "ah", "doo", "eh"; "mm", "sh" have no vowel."""
    s = re.sub(r"[^a-z]", "", text.lower())
    pattern = "|".join(f"({p})" for p, _ in VOCALISE)
    s = re.sub(
        pattern, lambda m: m.group() if (v := VOCALISE[m.lastindex - 1][1]) is None else v, s
    )
    return at_most_two_vowels(collapse(s))


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

    def read(self, word, phonemes):
        self.note("read", word, phonemes)

    def guessed(self, word, phonemes):
        self.note("guessed from spelling", word, phonemes)

    def fitted(self, word, n, vowels):
        self.note("fitted", word, f"{vowels} vowels in the dictionary, {n} syllables sung")

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
    for word, spec in entry.get("phonemes", {}).items():
        sylls = ["" if p == "-" else p for p in spec.split()]
        bad = {c for p in sylls for c in p} - PHONEMES
        if bad or any(sum(c in VOWELS for c in p) > 2 for p in sylls):
            sys.exit(f"{season}: phonemes of {word!r}: {spec!r} isn't phonemes of vowels.ts")
        overrides[word.lower()] = sylls

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
            texts = [s["text"] for s in sylls[i:j]]
            if word in overrides:
                phonemes = overrides[word]
                if len(phonemes) != n:
                    print(f"  phonemes of {word!r}: {len(phonemes)} given, {n} syllables sung")
                    phonemes = (phonemes + phonemes[-1:] * n)[:n]
            elif lang == "en":
                english = english or English()
                phonemes = english.word(word, n, report) if word else [""] * n
            elif lang == "la":
                phonemes = latin(texts)
            elif lang == "fr":
                phonemes = french(texts)
            elif lang == "vocalise":
                phonemes = [vocalise(t) for t in texts]
            else:
                sys.exit(f"{season}: unknown language {lang!r}")
            for s, p in zip(sylls[i:j], phonemes):
                s.pop("v", None)
                s.pop("p", None)
                if p:
                    s["p"] = p
            i = j

    print(f"{piece_dir}: vowels of " + ", ".join(
        f"{v['name']} {sum(any(c in VOWELS for c in s.get('p', '')) for s in v['syllables'])}"
        f"/{len(v['syllables'])}"
        for v in voices
    ))  # fmt: skip
    report.print()
    piece_path.write_text(json.dumps(piece, indent=0))


if __name__ == "__main__":
    main(sys.argv[1])
