// MuseScore's conversions, by its WebAssembly build (score-converter), much as `mscore -o`:
//
//   node tools/mscore.mjs score.mscz out.mid out.musicxml ... [-T margin out.svg ...]
//
// Writes each output in the format of its suffix: mid, musicxml, mscz, mpos, spos, svg or png.
// SVGs and PNGs are written per page as STEM-N.svg, as mscore does; those after -T are cropped to
// their content plus margin pixels, as mscore -T does.
//
//   node tools/mscore.mjs install [build.artifacts]
//
// copies the converter (default: ../MuseScore/build.artifacts, beside this repository) to
// ~/.cache/choirpractice-app/mscore-converter, which the conversions use, so that rebuilding
// MuseScore doesn't change it. The copy replaces the old one only once it has converted the demo's
// Frère Jacques. $CHOIRPRACTICE_MSCORE can name another directory with the converter's worker.mjs.

import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ScoreConverter } from "score-converter";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONVERTER =
    process.env.CHOIRPRACTICE_MSCORE ?? path.join(os.homedir(), ".cache/choirpractice-app/mscore-converter");

// Converts input to outputs [{file, format, trim?}] with the converter in dir.
async function convert(dir, input, outputs) {
    const worker = path.join(dir, "worker.mjs");
    try {
        await readFile(worker);
    } catch {
        throw new Error(`no converter at ${dir}: run node tools/mscore.mjs install`);
    }
    const log = [];
    const converter = new ScoreConverter({ workerUrl: pathToFileURL(worker), onLog: (text) => log.push(text) });
    try {
        const suffix = path.extname(input);
        const result = await converter.convert(
            { format: suffix.slice(1), data: await readFile(input), name: path.basename(input, suffix) },
            outputs.map(({ file, ...output }) => output),
        );
        for (const [i, { file }] of outputs.entries()) {
            const data = result.outputs[i];
            if (Array.isArray(data)) {
                const suffix = path.extname(file);
                const stem = file.slice(0, -suffix.length);
                await Promise.all(data.map((page, n) => writeFile(`${stem}-${n + 1}${suffix}`, page)));
            } else {
                await writeFile(file, data);
            }
        }
    } catch (e) {
        throw new Error(`${input}: ${e.message}${log.length ? `\n${log.join("\n")}` : ""}`);
    } finally {
        converter.close();
    }
}

async function install(src = path.join(REPO, "../MuseScore/build.artifacts")) {
    const fresh = `${CONVERTER}.new`;
    await rm(fresh, { recursive: true, force: true });
    await cp(src, fresh, { recursive: true });
    const trial = path.join(os.tmpdir(), `choirpractice-trial-${process.pid}.mid`);
    try {
        await convert(fresh, path.join(REPO, "media/demo/frere-jacques.mscz"), [{ file: trial, format: "mid" }]);
    } finally {
        await rm(trial, { force: true });
    }
    await rm(CONVERTER, { recursive: true, force: true });
    await rename(fresh, CONVERTER);
    console.error(`installed ${src} as ${CONVERTER}`);
}

const [command, ...args] = process.argv.slice(2);
try {
    if (command === "install") {
        await install(...args);
    } else {
        const outputs = [];
        let trim;
        for (let i = 0; i < args.length; i++) {
            if (args[i] === "-T") {
                trim = Number(args[++i]);
                continue;
            }
            const format = path.extname(args[i]).slice(1);
            const paged = format === "svg" || format === "png";
            outputs.push({ file: args[i], format, ...(paged && trim !== undefined ? { trim } : {}) });
        }
        if (!command || outputs.length === 0) {
            console.error("usage: mscore.mjs score.mscz output... [-T margin output...]\n       mscore.mjs install [build.artifacts]");
            process.exit(2);
        }
        await convert(CONVERTER, command, outputs);
    }
} catch (e) {
    console.error(e.message);
    process.exitCode = 1;
}
