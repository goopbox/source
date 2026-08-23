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

test("sample previews use raw PCM and loop controls without starting the song", async (context) => {
  const { SynthController, cleanup } = await loadSynthController();
  context.after(cleanup);

  const controller = new SynthController();
  const commands = [];
  const output = {};
  const createdSources = [];
  const createdBuffers = [];
  let suspendCount = 0;
  const audioContext = {
    state: "running",
    createBuffer: (channelCount, length, sampleRate) => {
      const channel = new Float32Array(length);
      const buffer = {
        channelCount,
        length,
        sampleRate,
        getChannelData: (channelIndex) => {
          assert.equal(channelIndex, 0);
          return channel;
        },
      };
      createdBuffers.push(buffer);
      return buffer;
    },
    createBufferSource: () => {
      const source = {
        buffer: null,
        onended: null,
        connectedTo: null,
        started: false,
        startArguments: null,
        stopped: false,
        disconnected: false,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        connect(target) {
          this.connectedTo = target;
        },
        disconnect() {
          this.disconnected = true;
        },
        start(...args) {
          this.started = true;
          this.startArguments = args;
        },
        stop() {
          this.stopped = true;
        },
      };
      createdSources.push(source);
      return source;
    },
    suspend: () => {
      suspendCount++;
      audioContext.state = "suspended";
      return Promise.resolve();
    },
  };
  controller.audioContext = audioContext;
  controller.outputGainNode = output;
  controller.audioWorkletNode = {
    port: { postMessage: (command) => commands.push(command) },
  };
  const samples = new Float32Array([0.25, -0.5, 0.75]);
  controller.sampleAssets.set("recording", { samples, sampleRate: 32000 });
  let endedCount = 0;

  assert.equal(
    controller.playSamplePreview(
      "recording",
      {
        offsetFrame: 2,
        loopStartFrame: 1,
        loopEndFrame: 3,
        oneshot: false,
      },
      () => endedCount++,
    ),
    true,
  );
  assert.equal(controller.playing, false);
  assert.equal(commands.some((command) => command.type == "play"), false);
  assert.equal(createdBuffers.length, 1);
  assert.equal(createdBuffers[0].channelCount, 1);
  assert.equal(createdBuffers[0].sampleRate, 32000);
  assert.deepEqual([...createdBuffers[0].getChannelData(0)], [...samples]);
  assert.equal(createdSources[0].buffer, createdBuffers[0]);
  assert.equal(createdSources[0].connectedTo, output);
  assert.equal(createdSources[0].started, true);
  assert.equal(createdSources[0].loop, true);
  assert.equal(createdSources[0].loopStart, 1 / 32000);
  assert.equal(createdSources[0].loopEnd, 3 / 32000);
  assert.deepEqual(createdSources[0].startArguments, [0, 2 / 32000]);

  assert.equal(
    controller.playSamplePreview(
      "recording",
      {
        offsetFrame: 1,
        loopStartFrame: 1,
        loopEndFrame: 3,
        oneshot: true,
      },
      () => endedCount++,
    ),
    true,
  );
  assert.equal(createdSources[0].stopped, true);
  assert.equal(createdSources[0].disconnected, true);
  assert.equal(endedCount, 0);
  assert.equal(createdSources[1].started, true);
  assert.equal(createdSources[1].loop, false);
  assert.equal(createdSources[1].loopStart, 1 / 32000);
  assert.equal(createdSources[1].loopEnd, 3 / 32000);
  assert.deepEqual(createdSources[1].startArguments, [
    0,
    1 / 32000,
    2 / 32000,
  ]);
  createdSources[1].onended();
  assert.equal(createdSources[1].disconnected, true);
  assert.equal(endedCount, 1);
  assert.equal(suspendCount, 1);
  assert.equal(
    controller.playSamplePreview(
      "missing",
      {
        offsetFrame: 0,
        loopStartFrame: 0,
        loopEndFrame: 1,
        oneshot: false,
      },
      () => endedCount++,
    ),
    false,
  );
});
