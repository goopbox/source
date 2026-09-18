// Distributed under the Unlicense.

import { type AssetDefinition, getAssetName } from "../synth/synth-config.js";
import { ChangeAssets, applySoundFontPreset } from "./changes.js";
import {
  type FlpChannelSource,
  type FlpSongImport,
  getFruitySoundFontPresetIndex,
} from "./flp-import.js";
import { assetCacheEvents, getPinnedAssets } from "../synth/asset-cache.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./prompt.js";
import type { SongDocument } from "./song-document.js";
import type { SoundFontPresetInfo } from "../synth/synth-controller.js";

const { button, dialog, div, h2, h3, label, option, select, span } = HTML;

interface ChannelSelection {
  soundFontId: string | null;
  presetIndex: number | null;
}

export class FlpInstrumentPrompt implements Prompt {
  readonly #doc: SongDocument;
  readonly #imported: FlpSongImport;
  readonly #confirm: () => void;
  readonly #close: () => void;
  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt flpInstrumentPrompt" },
    h2("FLP Instruments"),
  );
  readonly #channelRows: HTMLDivElement = div({
    class: "assetsPromptRows",
  });
  readonly #pinnedRows: HTMLDivElement = div({
    class: "assetsPromptRows",
  });
  readonly #okayButton: HTMLButtonElement = button({ type: "button" }, "Okay");
  readonly #closeButton: HTMLButtonElement = button({
    class: "cancelButton",
    type: "button",
  });
  readonly #selections: ChannelSelection[];

  public constructor(
    _doc: SongDocument,
    _imported: FlpSongImport,
    _confirm: () => void,
    _close: () => void,
  ) {
    this.#doc = _doc;
    this.#imported = _imported;
    this.#confirm = _confirm;
    this.#close = _close;
    const defaultSoundFontId: string | null =
      this.#doc.song.assets.find((asset: AssetDefinition): boolean => asset.type === "soundFont")
        ?.id ?? null;
    this.#selections = _imported.pitchChannels.map(
      (_channel, channelIndex: number): ChannelSelection => ({
        soundFontId: defaultSoundFontId,
        presetIndex:
          defaultSoundFontId == null
            ? null
            : getFruitySoundFontPresetIndex(
                _imported.channelSources[channelIndex]!,
                this.#doc.synth.getSoundFontPresets(defaultSoundFontId),
              ),
      }),
    );
    const columns: HTMLDivElement = div(
      { class: "assetsPromptColumns" },
      div({ class: "assetsPromptColumn" }, h3("Imported Channels"), this.#channelRows),
      div(
        { class: "assetsPromptColumn pinnedAssetsColumn" },
        h3("Pinned SoundFonts"),
        this.#pinnedRows,
      ),
    );
    this.container.append(
      columns,
      div({ class: "button-row" }, this.#okayButton),
      this.#closeButton,
    );
    this.#okayButton.addEventListener("click", this.#apply);
    this.#closeButton.addEventListener("click", this.#close);
    this.#doc.synth.assetLoadEvents.addEventListener("change", this.#render);
    assetCacheEvents.addEventListener("change", this.#render);
    this.#render();
  }

  #render = (): void => {
    this.#channelRows.replaceChildren();
    const soundFonts: AssetDefinition[] = this.#doc.song.assets.filter(
      (asset: AssetDefinition): boolean => asset.type === "soundFont",
    );
    let canApply = true;

    for (let channelIndex = 0; channelIndex < this.#imported.pitchChannels.length;) {
      const startChannelIndex: number = channelIndex,
        source: FlpChannelSource = this.#imported.channelSources[startChannelIndex]!;
      let endChannelIndex: number = startChannelIndex + 1;
      while (
        endChannelIndex < this.#imported.pitchChannels.length &&
        this.#imported.channelSources[endChannelIndex]!.sourceChannelId === source.sourceChannelId
      ) {
        endChannelIndex++;
      }
      const selection: ChannelSelection = this.#selections[startChannelIndex]!,
        soundFontSelect: HTMLSelectElement = select(
          {
            "aria-label": `SoundFont for ${this.#channelLabel(startChannelIndex, endChannelIndex)}`,
          },
          option({ value: "" }, "No SoundFont"),
        );
      for (const soundFont of soundFonts) {
        soundFontSelect.append(option({ value: soundFont.id }, soundFont.name));
      }
      if (
        selection.soundFontId != null &&
        soundFonts.some((asset: AssetDefinition): boolean => asset.id === selection.soundFontId)
      ) {
        soundFontSelect.value = selection.soundFontId;
      } else {
        this.#setGroupSelection(startChannelIndex, endChannelIndex, null, null);
      }

      const presetSelect: HTMLSelectElement = select({
        "aria-label": `SoundFont instrument for ${this.#channelLabel(startChannelIndex, endChannelIndex)}`,
      });
      let presets: readonly SoundFontPresetInfo[] | null = null;
      if (selection.soundFontId == null) {
        presetSelect.append(option({ value: "" }, "Choose a SoundFont first"));
        presetSelect.disabled = true;
      } else {
        presets = this.#doc.synth.getSoundFontPresets(selection.soundFontId);
        if (presets == null) {
          const status: string | null = this.#doc.synth.getAssetLoadStatus(selection.soundFontId);
          presetSelect.append(
            option({ value: "" }, status === "error" ? "Failed to load" : "Loading…"),
          );
          presetSelect.disabled = true;
          canApply = false;
        } else if (presets.length === 0) {
          presetSelect.append(option({ value: "" }, "No instruments"));
          presetSelect.disabled = true;
          canApply = false;
        } else {
          for (const preset of presets) {
            presetSelect.append(option({ value: preset.index }, preset.name));
          }
          if (
            !presets.some(
              (preset: SoundFontPresetInfo): boolean => preset.index === selection.presetIndex,
            )
          ) {
            const importedPresetIndex: number | null = getFruitySoundFontPresetIndex(
              source,
              presets,
            );
            this.#setGroupSelection(
              startChannelIndex,
              endChannelIndex,
              selection.soundFontId,
              importedPresetIndex ?? presets[0]!.index,
            );
          }
          presetSelect.value = String(selection.presetIndex);
        }
      }

      soundFontSelect.addEventListener("change", (): void => {
        this.#setGroupSoundFont(startChannelIndex, endChannelIndex, soundFontSelect.value || null);
        this.#render();
      });
      presetSelect.addEventListener("change", (): void => {
        this.#setGroupSelection(
          startChannelIndex,
          endChannelIndex,
          selection.soundFontId,
          Number(presetSelect.value),
        );
        this.#render();
      });

      const sourceName: string = this.#sourceName(source),
        details: string[] = this.#sourceDetails(source, presets);
      this.#channelRows.append(
        div(
          { class: "assetCard flpChannelCard" },
          label(
            { class: "assetName" },
            `${this.#channelLabel(startChannelIndex, endChannelIndex)}: ${sourceName}`,
          ),
          span({ class: "flpSourceDetails" }, details.join(" · ")),
          div(
            { class: "flpInstrumentControls" },
            label("SoundFont", soundFontSelect),
            label("Instrument", presetSelect),
          ),
        ),
      );
      channelIndex = endChannelIndex;
    }
    this.#okayButton.disabled = !canApply;

    this.#pinnedRows.replaceChildren();
    const pinnedSoundFonts: AssetDefinition[] = getPinnedAssets().filter(
      (asset: AssetDefinition): boolean => asset.type === "soundFont",
    );
    for (const asset of pinnedSoundFonts) {
      const inserted: boolean = this.#doc.song.assets.some(
          (songAsset: AssetDefinition): boolean => songAsset.source === asset.source,
        ),
        insertButton: HTMLButtonElement = button(
          { type: "button" },
          inserted ? "Inserted" : "Insert",
        );
      insertButton.disabled = inserted;
      insertButton.addEventListener("click", (): void => this.#insertAsset(asset));
      this.#pinnedRows.append(
        div(
          { class: "assetCard compactAssetCard" },
          label({ class: "assetName" }, getAssetName(asset.url)),
          div({ class: "assetControls" }, insertButton),
        ),
      );
    }
    if (pinnedSoundFonts.length === 0) {
      this.#pinnedRows.append(span("No pinned SoundFonts."));
    }
  };

  #sourceName(source: FlpChannelSource): string {
    if (source.name != null && source.name.trim() !== "") {
      return source.name;
    }
    if (source.plugin?.name != null) {
      return source.plugin.name;
    }
    if (source.plugin?.internalName != null && source.plugin.internalName !== "Fruity Wrapper") {
      return source.plugin.internalName;
    }
    if (source.samplePath != null) {
      return getAssetName(source.samplePath);
    }
    return `FL channel ${source.sourceChannelId + 1}`;
  }

  #sourceDetails(
    source: FlpChannelSource,
    presets: readonly SoundFontPresetInfo[] | null,
  ): string[] {
    const details: string[] = [],
      pluginName: string | undefined = source.plugin?.name ?? source.plugin?.internalName;
    if (pluginName != null) {
      details.push(
        source.plugin?.vendor == null ? pluginName : `${pluginName} by ${source.plugin.vendor}`,
      );
    }
    if (source.plugin?.statePath != null) {
      details.push(getAssetName(source.plugin.statePath));
    }
    const importedPresetIndex: number | null = getFruitySoundFontPresetIndex(source, presets);
    if (importedPresetIndex != null) {
      details.push(`Preset ${importedPresetIndex + 1}`);
    }
    if (source.samplePath != null) {
      details.push(`Sample: ${getAssetName(source.samplePath)}`);
    }
    return details;
  }

  #channelLabel(startChannelIndex: number, endChannelIndex: number): string {
    const start: number = startChannelIndex + 1,
      end: number = endChannelIndex;
    return start === end ? `Channel ${start}` : `Channels ${start}-${end}`;
  }

  #setGroupSelection(
    startChannelIndex: number,
    endChannelIndex: number,
    soundFontId: string | null,
    presetIndex: number | null,
  ): void {
    for (let channelIndex = startChannelIndex; channelIndex < endChannelIndex; channelIndex++) {
      const selection: ChannelSelection = this.#selections[channelIndex]!;
      selection.soundFontId = soundFontId;
      selection.presetIndex = presetIndex;
    }
  }

  #setGroupSoundFont(
    startChannelIndex: number,
    endChannelIndex: number,
    soundFontId: string | null,
  ): void {
    this.#setGroupSelection(
      startChannelIndex,
      endChannelIndex,
      soundFontId,
      soundFontId == null
        ? null
        : getFruitySoundFontPresetIndex(
            this.#imported.channelSources[startChannelIndex]!,
            this.#doc.synth.getSoundFontPresets(soundFontId),
          ),
    );
  }

  #insertAsset(asset: AssetDefinition): void {
    if (
      this.#doc.song.assets.some(
        (songAsset: AssetDefinition): boolean => songAsset.source === asset.source,
      )
    ) {
      return;
    }
    const isFirstSoundFont: boolean =
      asset.type === "soundFont" &&
      !this.#doc.song.assets.some(
        (songAsset: AssetDefinition): boolean => songAsset.type === "soundFont",
      );
    this.#doc.record(new ChangeAssets(this.#doc, [...this.#doc.song.assets, asset]));
    if (isFirstSoundFont) {
      for (let channelIndex = 0; channelIndex < this.#selections.length; channelIndex++) {
        this.#setGroupSoundFont(channelIndex, channelIndex + 1, asset.id);
      }
    }
    this.#render();
  }

  #apply = (): void => {
    for (let channelIndex = 0; channelIndex < this.#selections.length; channelIndex++) {
      const selection: ChannelSelection = this.#selections[channelIndex]!;
      if (selection.soundFontId == null || selection.presetIndex == null) {
        continue;
      }
      const preset: SoundFontPresetInfo | undefined = this.#doc.synth
        .getSoundFontPresets(selection.soundFontId)
        ?.find(
          (candidate: SoundFontPresetInfo): boolean => candidate.index === selection.presetIndex,
        );
      if (preset == null) {
        return;
      }
      applySoundFontPreset(
        this.#imported.pitchChannels[channelIndex]!.instruments[0]!,
        selection.soundFontId,
        preset,
        this.#imported.tempo,
        false,
      );
    }
    this.#confirm();
  };

  public cleanUp = (): void => {
    this.#okayButton.removeEventListener("click", this.#apply);
    this.#closeButton.removeEventListener("click", this.#close);
    this.#doc.synth.assetLoadEvents.removeEventListener("change", this.#render);
    assetCacheEvents.removeEventListener("change", this.#render);
  };
}
