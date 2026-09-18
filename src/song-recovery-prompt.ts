// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  type RecoveredSong,
  type RecoveredVersion,
  SongRecovery,
  errorAlert,
  versionToKey,
} from "./song-recovery.js";
import { ChangeSong } from "./changes.js";
import { Config } from "../synth/synth-config.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./prompt.js";
import { Song } from "../synth/synth.js";
import type { SongDocument } from "./song-document.js";
import { SynthController } from "../synth/synth-controller.js";
import { decodeSongUrlHash } from "./song-url.js";

const { button, code, dialog, div, h2, p, select, option } = HTML;

interface RecoveryControls {
  versionMenu: HTMLSelectElement;
  previewButton: HTMLButtonElement;
  openButton: HTMLButtonElement;
  onVersionChange: () => void;
  onPreview: () => void;
  onOpen: () => void;
}

export class SongRecoveryPrompt implements Prompt {
  #doc: SongDocument;
  readonly #songContainer: HTMLDivElement = div();
  readonly #cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
  });
  readonly #previewSynth: SynthController;
  readonly #controls: RecoveryControls[] = [];
  #activePreviewButton: HTMLButtonElement | null = null;

  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt", style: "width: 300px;" },
    h2("Song Recovery"),
    div(
      { class: "flush-top", style: "max-height: 385px; overflow-y: auto;" },
      p(
        "Songs in this list may be removed at any time for any reason, or none at all. Export your songs in the ",
        code(".goop"),
        " format.",
      ),
      this.#songContainer,
    ),
    this.#cancelButton,
  );

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    const { chipWaves } = Config;
    try {
      this.#previewSynth = new SynthController();
    } finally {
      Config.chipWaves = chipWaves;
    }
    this.#cancelButton.addEventListener("click", this.#close);

    const songs: RecoveredSong[] = SongRecovery.getAllRecoveredSongs();

    if (songs.length === 0) {
      this.#songContainer.append(
        p("There are no recovered songs available yet. Try making a song!"),
      );
    }

    for (const song of songs) {
      const versionMenu: HTMLSelectElement = select({ style: "width: 100%;" });

      for (const version of song.versions) {
        versionMenu.append(
          option({ value: version.time }, new Date(version.time).toLocaleString()),
        );
      }

      const previewButton: HTMLButtonElement = button({ class: "playButton" }, "Preview"),
        openButton: HTMLButtonElement = button("Open"),
        container: HTMLDivElement = div(
          { style: "margin: 8px 0;" },
          versionMenu,
          div({ class: "button-row" }, previewButton, openButton),
        );
      this.#songContainer.append(container);

      const onVersionChange = (): void => {
          if (this.#activePreviewButton === previewButton) {
            this.#playPreview(song, versionMenu, previewButton);
          }
        },
        onPreview = (): void => {
          if (this.#activePreviewButton === previewButton) {
            this.#stopPreview();
          } else {
            this.#playPreview(song, versionMenu, previewButton);
          }
        },
        onOpen = (): void => this.#openSong(song, versionMenu);

      versionMenu.addEventListener("change", onVersionChange);
      previewButton.addEventListener("click", onPreview);
      openButton.addEventListener("click", onOpen);
      this.#controls.push({
        versionMenu,
        previewButton,
        openButton,
        onVersionChange,
        onPreview,
        onOpen,
      });
    }
  }

  #getSongData(song: RecoveredSong, versionMenu: HTMLSelectElement): Uint8Array {
    const version: RecoveredVersion | undefined = song.versions[versionMenu.selectedIndex]!,
      songData: string | null =
        version === undefined ? null : window.localStorage.getItem(versionToKey(version));
    if (songData == null) {
      throw new Error("This recovered song version is no longer available.");
    }
    const decoded: Uint8Array | null = decodeSongUrlHash(songData);
    if (decoded == null) {
      throw new Error("This recovered song version is invalid.");
    }
    return decoded;
  }

  #playPreview(
    song: RecoveredSong,
    versionMenu: HTMLSelectElement,
    previewButton: HTMLButtonElement,
  ): void {
    const previousChipWaves = Config.chipWaves;
    try {
      const songData: Uint8Array = this.#getSongData(song, versionMenu);
      this.#stopPreview();
      const previewSong: Song = new Song(songData);
      this.#previewSynth.setSong(previewSong);
      this.#previewSynth.snapToStart();
      this.#previewSynth.play();
      this.#activePreviewButton = previewButton;
      this.#setPreviewButtonPlaying(previewButton, true);
    } catch (error) {
      errorAlert(error);
    } finally {
      Config.chipWaves = previousChipWaves;
    }
  }

  #stopPreview(): void {
    this.#previewSynth.pause();
    if (this.#activePreviewButton != null) {
      this.#setPreviewButtonPlaying(this.#activePreviewButton, false);
      this.#activePreviewButton = null;
    }
  }

  #setPreviewButtonPlaying(previewButton: HTMLButtonElement, playing: boolean): void {
    previewButton.classList.toggle("playButton", !playing);
    previewButton.classList.toggle("pauseButton", playing);
    previewButton.textContent = playing ? "Pause" : "Preview";
  }

  #openSong(song: RecoveredSong, versionMenu: HTMLSelectElement): void {
    try {
      const songData: Uint8Array = this.#getSongData(song, versionMenu),
        change: ChangeSong = new ChangeSong(this.#doc, songData);
      this.#stopPreview();
      this.#doc.goBackToStart();
      this.#doc.closePrompt();
      this.#doc.record(change, false, true);
    } catch (error) {
      errorAlert(error);
    }
  }

  #close = (): void => {
    this.#doc.closePrompt();
  };

  public cleanUp = (): void => {
    this.#cancelButton.removeEventListener("click", this.#close);
    for (const controls of this.#controls) {
      controls.versionMenu.removeEventListener("change", controls.onVersionChange);
      controls.previewButton.removeEventListener("click", controls.onPreview);
      controls.openButton.removeEventListener("click", controls.onOpen);
    }
    this.#previewSynth.dispose();
  };
}
