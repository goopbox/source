// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { SongDocument } from "./SongDocument.js";
import {
  type RecoveredSong,
  SongRecovery,
  type RecoveredVersion,
  errorAlert,
  versionToKey,
} from "./SongRecovery.js";
import { type Prompt } from "./Prompt.js";
import { ChangeSong } from "./changes.js";
import { Config } from "../synth/SynthConfig.js";
import { Song } from "../synth/synth.js";
import { SynthController } from "../synth/SynthController.js";
import { decodeSongUrlHash } from "./SongUrl.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";

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
  private readonly _songContainer: HTMLDivElement = div();
  private readonly _cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
  });
  private readonly _previewSynth: SynthController;
  private readonly _controls: RecoveryControls[] = [];
  private _activePreviewButton: HTMLButtonElement | null = null;

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
      this._songContainer,
    ),
    this._cancelButton,
  );

  constructor(private _doc: SongDocument) {
    const chipWaves = Config.chipWaves;
    try {
      this._previewSynth = new SynthController();
    } finally {
      Config.chipWaves = chipWaves;
    }
    this._cancelButton.addEventListener("click", this._close);

    const songs: RecoveredSong[] = SongRecovery.getAllRecoveredSongs();

    if (songs.length == 0) {
      this._songContainer.appendChild(
        p("There are no recovered songs available yet. Try making a song!"),
      );
    }

    for (const song of songs) {
      const versionMenu: HTMLSelectElement = select({ style: "width: 100%;" });

      for (const version of song.versions) {
        versionMenu.appendChild(
          option(
            { value: version.time },
            new Date(version.time).toLocaleString(),
          ),
        );
      }

      const previewButton: HTMLButtonElement = button(
        { class: "playButton" },
        "Preview",
      );
      const openButton: HTMLButtonElement = button("Open");
      const container: HTMLDivElement = div(
        { style: "margin: 8px 0;" },
        versionMenu,
        div({ class: "button-row" }, previewButton, openButton),
      );
      this._songContainer.appendChild(container);

      const onVersionChange = (): void => {
        if (this._activePreviewButton == previewButton) {
          this._playPreview(song, versionMenu, previewButton);
        }
      };
      const onPreview = (): void => {
        if (this._activePreviewButton == previewButton) {
          this._stopPreview();
        } else {
          this._playPreview(song, versionMenu, previewButton);
        }
      };
      const onOpen = (): void => this._openSong(song, versionMenu);

      versionMenu.addEventListener("change", onVersionChange);
      previewButton.addEventListener("click", onPreview);
      openButton.addEventListener("click", onOpen);
      this._controls.push({
        versionMenu,
        previewButton,
        openButton,
        onVersionChange,
        onPreview,
        onOpen,
      });
    }
  }

  private _getSongData(
    song: RecoveredSong,
    versionMenu: HTMLSelectElement,
  ): Uint8Array {
    const version: RecoveredVersion | undefined =
      song.versions[versionMenu.selectedIndex];
    const songData: string | null =
      version == undefined
        ? null
        : window.localStorage.getItem(versionToKey(version));
    if (songData == null)
      throw new Error("This recovered song version is no longer available.");
    const decoded: Uint8Array | null = decodeSongUrlHash(songData);
    if (decoded == null)
      throw new Error("This recovered song version is invalid.");
    return decoded;
  }

  private _playPreview(
    song: RecoveredSong,
    versionMenu: HTMLSelectElement,
    previewButton: HTMLButtonElement,
  ): void {
    const previousChipWaves = Config.chipWaves;
    try {
      const songData: Uint8Array = this._getSongData(song, versionMenu);
      this._stopPreview();
      const previewSong: Song = new Song(songData);
      this._previewSynth.setSong(previewSong);
      this._previewSynth.snapToStart();
      this._previewSynth.play();
      this._activePreviewButton = previewButton;
      this._setPreviewButtonPlaying(previewButton, true);
    } catch (error) {
      errorAlert(error);
    } finally {
      Config.chipWaves = previousChipWaves;
    }
  }

  private _stopPreview(): void {
    this._previewSynth.pause();
    if (this._activePreviewButton != null) {
      this._setPreviewButtonPlaying(this._activePreviewButton, false);
      this._activePreviewButton = null;
    }
  }

  private _setPreviewButtonPlaying(
    button: HTMLButtonElement,
    playing: boolean,
  ): void {
    button.classList.toggle("playButton", !playing);
    button.classList.toggle("pauseButton", playing);
    button.textContent = playing ? "Pause" : "Preview";
  }

  private _openSong(song: RecoveredSong, versionMenu: HTMLSelectElement): void {
    try {
      const songData: Uint8Array = this._getSongData(song, versionMenu);
      const change: ChangeSong = new ChangeSong(this._doc, songData);
      this._stopPreview();
      this._doc.goBackToStart();
      this._doc.closePrompt();
      this._doc.record(change, false, true);
    } catch (error) {
      errorAlert(error);
    }
  }

  private _close = (): void => {
    this._doc.closePrompt();
  };

  public cleanUp = (): void => {
    this._cancelButton.removeEventListener("click", this._close);
    for (const controls of this._controls) {
      controls.versionMenu.removeEventListener(
        "change",
        controls.onVersionChange,
      );
      controls.previewButton.removeEventListener("click", controls.onPreview);
      controls.openButton.removeEventListener("click", controls.onOpen);
    }
    this._previewSynth.dispose();
  };
}
