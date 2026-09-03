import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadRewriteHelper() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-asset-source-paste-test-"),
  );
  const outfile = join(directory, "asset-source-paste.mjs");
  await build({
    entryPoints: ["src/AssetSourcePaste.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const helpers = await import(pathToFileURL(outfile).href);
  return { helpers, cleanup: () => rm(directory, { recursive: true }) };
}

test("pasted Dropbox asset links use the direct-download host", async (context) => {
  const { helpers, cleanup } = await loadRewriteHelper();
  context.after(cleanup);
  const source =
    "https://www.dropbox.com/scl/fi/ybbirfmohe697cc9o7bew/FinalFantasyMQ.sf2?rlkey=6tls4jow1pm8bdba9zytdej31&st=g0fg6m3o&dl=0";

  assert.equal(
    helpers.rewritePastedAssetSource(source),
    "https://dl.dropboxusercontent.com/scl/fi/ybbirfmohe697cc9o7bew/FinalFantasyMQ.sf2?rlkey=6tls4jow1pm8bdba9zytdej31&st=g0fg6m3o",
  );
});

test("paste rewrite preserves all unrelated text", async (context) => {
  const { helpers, cleanup } = await loadRewriteHelper();
  context.after(cleanup);

  assert.equal(
    helpers.rewritePastedAssetSource(
      "prefix https://example.com/file.sf2?dl=0&other=1 suffix",
    ),
    "prefix https://example.com/file.sf2?dl=0&other=1 suffix",
  );
});
