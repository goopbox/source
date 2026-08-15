import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadSongUrlModules() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-song-url-test-"));
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {decodeSongUrlHash, encodeSongUrl} from "./src/SongUrl.ts";',
        'export {extractCompressedSongBody} from "./synth/SongBinary.ts";',
        'export {Song} from "./synth/synth.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "song-url-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return { ...module, cleanup: () => rm(directory, { recursive: true }) };
}

test("song URLs are only the unpadded URL-safe Base64 compressed body", async (context) => {
  const {
    Song,
    decodeSongUrlHash,
    encodeSongUrl,
    extractCompressedSongBody,
    cleanup,
  } = await loadSongUrlModules();
  context.after(cleanup);
  const songData = new Song().toBinary();
  const compressedBody = extractCompressedSongBody(songData);
  assert.notEqual(compressedBody, null);

  const encoded = encodeSongUrl(songData);
  assert.equal(encodeSongUrl(songData), encoded);
  assert.match(encoded, /^#[A-Za-z0-9_-]+$/);
  assert.equal(encoded.includes("="), false);
  assert.equal(
    encoded.startsWith("#s"),
    false,
    "song URLs must not have the old s/version prefix",
  );
  assert.deepEqual(
    new Uint8Array(Buffer.from(encoded.slice(1), "base64url")),
    compressedBody,
  );
  assert.deepEqual(decodeSongUrlHash(encoded), songData);
});

test("song URLs reject old markers, non-base64url characters, and malformed payloads", async (context) => {
  const { Song, decodeSongUrlHash, encodeSongUrl, cleanup } =
    await loadSongUrlModules();
  context.after(cleanup);
  const payload = encodeSongUrl(new Song().toBinary()).slice(1);

  assert.equal(
    decodeSongUrlHash(`#s4.${payload}`),
    null,
    "old prefixed song URLs must not be accepted",
  );
  assert.equal(
    decodeSongUrlHash("#AA+"),
    null,
    "characters outside base64url must not match a song URL",
  );
  assert.equal(
    decodeSongUrlHash("#AA="),
    null,
    "base64 padding must not match a song URL",
  );
  assert.throws(
    () => decodeSongUrlHash("#AB"),
    /Invalid song URL payload/,
    "unused tail bits must be zero",
  );
  assert.throws(
    () => decodeSongUrlHash("#AAAAA"),
    /Invalid song URL payload/,
    "base64url lengths congruent to one are invalid",
  );
  assert.equal(
    decodeSongUrlHash("#j1.e30"),
    null,
    "old JSON URLs must be ignored",
  );
});

test("song URL encoding only accepts the current .goop container", async (context) => {
  const { encodeSongUrl, cleanup } = await loadSongUrlModules();
  context.after(cleanup);
  assert.throws(
    () => encodeSongUrl(Uint8Array.of(0x00, 0xff)),
    /Invalid or unsupported \.goop song data/,
  );
});
