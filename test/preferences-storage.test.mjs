import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadPreferences() {
  const directory = await mkdtemp(join(tmpdir(), "goopbox-preferences-test-"));
  const outfile = join(directory, "preferences.mjs");
  await build({
    entryPoints: ["src/Preferences.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return {
    Preferences: module.Preferences,
    cleanup: () => rm(directory, { recursive: true }),
  };
}

function restoreWindow(descriptor) {
  if (descriptor == undefined) {
    delete globalThis.window;
  } else {
    Object.defineProperty(globalThis, "window", descriptor);
  }
}

test("preferences use defaults when localStorage access throws", async (context) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  context.after(() => restoreWindow(previousWindow));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.create(null, {
      localStorage: {
        get() {
          throw new DOMException("Storage is disabled", "SecurityError");
        },
      },
    }),
  });
  const { Preferences, cleanup } = await loadPreferences();
  context.after(cleanup);

  let preferences;
  assert.doesNotThrow(() => {
    preferences = new Preferences();
  });
  assert.equal(preferences.autoFollow, true);
  assert.equal(preferences.notesOutsideScale, false);
  assert.equal(preferences.rememberScaleChoice, true);
  assert.equal(preferences.keyboardLayout, "wickiHayden");
  assert.equal(preferences.layout, "long");
  assert.equal(preferences.masterVolume, Preferences.defaultMasterVolume);
  assert.equal(preferences.visibleOctaves, Preferences.defaultVisibleOctaves);
  assert.equal(preferences.defaultScale, 0);
  assert.doesNotThrow(() => preferences.save());
});

test("one failed preference write does not prevent later settings from saving", async (context) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  context.after(() => restoreWindow(previousWindow));
  const writes = [];
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
      setItem(name, value) {
        writes.push([name, value]);
        if (name == "autoFollow")
          throw new DOMException("Storage is full", "QuotaExceededError");
      },
      removeItem() {},
    },
  };
  const { Preferences, cleanup } = await loadPreferences();
  context.after(cleanup);
  const preferences = new Preferences();
  preferences.layout = "tall";
  preferences.masterVolume = 41;
  preferences.visibleOctaves = 5;

  assert.doesNotThrow(() => preferences.save());
  assert.ok(writes.some(([name, value]) => name == "volume" && value == "41"));
  assert.deepEqual(writes.at(-2), ["layout", "tall"]);
  assert.deepEqual(writes.at(-1), ["visibleOctaves", "5"]);
});

test("master volume uses a perceptual curve from 5% to 1x", async (context) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  context.after(() => restoreWindow(previousWindow));
  globalThis.window = {
    localStorage: {
      getItem() {
        return null;
      },
    },
  };
  const { Preferences, cleanup } = await loadPreferences();
  context.after(cleanup);

  assert.equal(Preferences.defaultMasterVolume, 100);
  assert.equal(Preferences.maxMasterVolume, 100);
  assert.equal(Preferences.masterVolumeToGain(0), 0);
  assert.equal(Preferences.masterVolumeToGain(1), 0.05);
  assert.ok(
    Math.abs(
      Preferences.masterVolumeToGain(50.5) -
        Math.sqrt(Preferences.masterVolumeMinGain),
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      Preferences.masterVolumeToGain(Preferences.maxMasterVolume) - 1.0,
    ) < 1e-12,
  );
  assert.equal(Preferences.masterVolumeToGain(100), 1);
});
