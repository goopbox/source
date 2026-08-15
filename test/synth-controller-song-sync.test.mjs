import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadSynthController() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-synth-controller-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    entryPoints: ["synth/SynthController.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return {
    SynthController: module.SynthController,
    cleanup: () => rm(directory, { recursive: true }),
  };
}

test("song synchronization compares binary contents and channel mutes", async (context) => {
  const { SynthController, cleanup } = await loadSynthController();
  context.after(cleanup);

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const pendingFrames = [];
  globalThis.requestAnimationFrame = (callback) => {
    pendingFrames.push(callback);
    return pendingFrames.length;
  };
  context.after(() => {
    if (originalRequestAnimationFrame == undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  const controller = new SynthController();
  const commands = [];
  controller.audioWorkletNode = {
    port: {
      postMessage: (command) => commands.push(command),
    },
  };
  const runSyncFrame = () => {
    assert.equal(pendingFrames.length, 1);
    pendingFrames.shift()(0);
  };

  controller.syncSong();
  runSyncFrame();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "setSong");

  controller.syncSong();
  runSyncFrame();
  assert.equal(
    commands.length,
    1,
    "an unchanged binary song should not be posted again",
  );

  controller.song.tempo++;
  controller.syncSong();
  runSyncFrame();
  assert.equal(
    commands.length,
    2,
    "changed binary song contents should be posted",
  );
  assert.equal(commands[1].type, "setSong");

  const binaryBeforeMute = controller.song.toBinary();
  controller.song.channels[0].muted = !controller.song.channels[0].muted;
  assert.deepEqual(
    controller.song.toBinary(),
    binaryBeforeMute,
    "mute state should remain outside the song binary",
  );
  controller.syncSong();
  runSyncFrame();
  assert.equal(commands.length, 3, "mute-only changes should be posted");
  assert.deepEqual(
    commands[2].mutedChannels,
    controller.song.channels.map((channel) => channel.muted),
  );
});

test("master volume clamps and updates the output gain", async (context) => {
  const { SynthController, cleanup } = await loadSynthController();
  context.after(cleanup);

  const controller = new SynthController();
  controller.outputGainNode = { gain: { value: 1 } };

  controller.masterVolume = 0.4;
  assert.equal(controller.masterVolume, 0.4);
  assert.equal(controller.outputGainNode.gain.value, 0.4);

  controller.masterVolume = 2;
  assert.equal(controller.masterVolume, 1);
  assert.equal(controller.outputGainNode.gain.value, 1);

  controller.masterVolume = -1;
  assert.equal(controller.masterVolume, 0);
  assert.equal(controller.outputGainNode.gain.value, 0);
});
