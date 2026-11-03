"""Encode each rendered stem as a series of short mono mp3 chunks, so the page can start playing early.

Usage: encode_stems.py workdir piece.json
Reads workdir/<name>.wav for every part plus workdir/baseline.wav, subtracts the baseline, and
writes the chunks of part file "audio/<name>" to <piece dir>/audio/<name>/<k>.mp3. Chunk k holds
samples [k*CHUNK, (k+1)*CHUNK), plus PAD samples of the neighbouring chunks on either side: mp3
frames near the edges of an encoding are noisy, and the padding keeps those frames out of the
stitched result. Adds an "audio" entry describing the chunking to piece.json.
"""
import array, concurrent.futures, json, os, pathlib, shutil, subprocess, sys, wave

RATE = 44100
CHUNK = 10 * RATE
PAD = RATE // 10

work, piece_path = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
piece = json.loads(piece_path.read_text())
out = piece_path.parent


def run(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def subtract_baseline(name):
    # 16-bit output is plenty for mp3 input and lets the wave module read the length. Mono halves
    # the download and the page's memory; the scores' panning isn't worth that.
    dst = work / f"{name}.stem.wav"
    run("-i", work / f"{name}.wav", "-i", work / "baseline.wav",
        "-filter_complex", "[1]volume=-1[neg];[0][neg]amix=inputs=2:normalize=0",
        "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", dst)
    with wave.open(str(dst)) as w:
        samples = array.array("h", w.readframes(w.getnframes()))
    # A silent stem means the part wasn't isolated: every variant rendered the same mix.
    assert max(samples, default=0) - min(samples, default=0) > 64, f"stem {name} is silent"
    return len(samples)


def encode_chunk(name, k, length):
    start, end = max(0, k * CHUNK - PAD), min(length, (k + 1) * CHUNK + PAD)
    run("-i", work / f"{name}.stem.wav", "-af", f"atrim=start_sample={start}:end_sample={end}",
        "-c:a", "libmp3lame", "-q:a", "2", out / "audio" / name / f"{k}.mp3")


names = [pathlib.Path(p["file"]).name for p in piece["parts"]]
with concurrent.futures.ThreadPoolExecutor(os.cpu_count()) as pool:
    lengths = set(pool.map(subtract_baseline, names))
    assert len(lengths) == 1, f"stems differ in length: {lengths}"
    length = lengths.pop()
    count = -(-length // CHUNK)
    shutil.rmtree(out / "audio", ignore_errors=True)
    for name in names:
        (out / "audio" / name).mkdir(parents=True)
    for f in [pool.submit(encode_chunk, n, k, length) for n in names for k in range(count)]:
        f.result()

piece["audio"] = {"rate": RATE, "length": length, "chunk": CHUNK, "pad": PAD}
piece_path.write_text(json.dumps(piece, indent=0))
print(f"{len(names)} stems of {length / RATE:.1f} s, {count} chunks each", file=sys.stderr)
