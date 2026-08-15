import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadChanges() {
  const directory = await mkdtemp(
    join(tmpdir(), "goopbox-undoable-changes-test-"),
  );
  const outfile = join(directory, "module.mjs");
  await build({
    stdin: {
      contents: [
        'export {ChangeDragSelectedNotes, ChangeTranspose} from "./src/changes.ts";',
        'export {Note, Pattern, Song, makeNotePin} from "./synth/synth.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      sourcefile: "undoable-changes-entry.ts",
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

function snapshotNotes(pattern) {
  return pattern.notes.map((note) => ({
    start: note.start,
    end: note.end,
    pitches: [...note.pitches],
    pins: note.pins.map((pin) => ({
      interval: pin.interval,
      time: pin.time,
      size: pin.size,
    })),
    continuesLastPattern: note.continuesLastPattern,
  }));
}

test("dragging a partial note can undo and redo without leaving split-note corruption", async (context) => {
  const { ChangeDragSelectedNotes, Note, Pattern, Song, makeNotePin, cleanup } =
    await loadChanges();
  context.after(cleanup);

  const song = new Song();
  const pattern = new Pattern();
  const note = new Note(24, 0, 12, 4);
  note.pitches = [24, 31];
  note.pins = [
    makeNotePin(0, 0, 4),
    makeNotePin(3, 6, 8),
    makeNotePin(-1, 12, 5),
  ];
  note.continuesLastPattern = true;
  pattern.notes.push(note);

  const originalPins = note.pins;
  const originalPinObjects = [...originalPins];
  const before = snapshotNotes(pattern);
  const doc = {
    song,
    channel: 0,
    prefs: { notesOutsideScale: true },
    selection: {
      patternSelectionActive: true,
      patternSelectionStart: 4,
      patternSelectionEnd: 8,
    },
    notifier: { changed() {} },
  };

  const change = new ChangeDragSelectedNotes(doc, 0, pattern, 1, 0);
  const after = snapshotNotes(pattern);
  assert.equal(change.isNoop(), false);
  assert.equal(pattern.notes.length, 3);
  assert.notDeepEqual(after, before);

  change.undo();
  assert.deepEqual(snapshotNotes(pattern), before);
  assert.equal(pattern.notes[0], note);
  assert.equal(note.pins, originalPins);
  assert.deepEqual(note.pins, originalPinObjects);
  for (let i = 0; i < originalPinObjects.length; i++)
    assert.equal(note.pins[i], originalPinObjects[i]);

  change.redo();
  assert.deepEqual(snapshotNotes(pattern), after);

  change.undo();
  assert.deepEqual(snapshotNotes(pattern), before);
  assert.equal(pattern.notes[0], note);
  assert.equal(note.pins, originalPins);
});

test("scale transposition follows the composing key", async (context) => {
  const { ChangeTranspose, Note, Pattern, Song, makeNotePin, cleanup } =
    await loadChanges();
  context.after(cleanup);

  const song = new Song();
  song.scale = 1; // Major.
  song.key = 0; // Playback key C.
  song.composingKey = 2; // Compose in D, so the stored scale is offset by two semitones.

  const pattern = new Pattern();
  const note = new Note(4, 0, 12, 4); // E in D major.
  note.pins = [
    makeNotePin(0, 0, 4),
    makeNotePin(3, 6, 4), // G in D major.
    makeNotePin(3, 12, 4),
  ];
  pattern.notes.push(note);

  const doc = {
    song,
    channel: 0,
    prefs: { notesOutsideScale: false },
    selection: { patternSelectionActive: false },
    notifier: { changed() {} },
  };

  const change = new ChangeTranspose(doc, 0, pattern, true);
  assert.deepEqual(note.pitches, [6]); // F# in D major, not F from C major.
  assert.deepEqual(
    note.pins.map((pin) => pin.interval),
    [0, 3, 3],
  );

  change.undo();
  assert.deepEqual(note.pitches, [4]);
  assert.deepEqual(
    note.pins.map((pin) => pin.interval),
    [0, 3, 3],
  );
});
