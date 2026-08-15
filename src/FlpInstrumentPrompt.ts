// Distributed under the Unlicense.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { getAssetName, type AssetDefinition } from "../synth/SynthConfig.js";
import { assetCacheEvents, getPinnedAssets } from "../synth/AssetCache.js";
import type { SoundFontPresetInfo } from "../synth/SynthController.js";
import type { FlpChannelSource, FlpSongImport } from "./FlpImport.js";
import { SongDocument } from "./SongDocument.js";
import { applySoundFontPreset, ChangeAssets } from "./changes.js";
import type { Prompt } from "./Prompt.js";

const { button, dialog, div, h2, h3, label, option, select, span } = HTML;

interface ChannelSelection {
  soundFontId: string | null;
  presetIndex: number | null;
}

export class FlpInstrumentPrompt implements Prompt {
  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt flpInstrumentPrompt" },
    h2("FLP Instruments"),
  );
  private readonly _channelRows: HTMLDivElement = div({
    class: "assetsPromptRows",
  });
  private readonly _pinnedRows: HTMLDivElement = div({
    class: "assetsPromptRows",
  });
  private readonly _okayButton: HTMLButtonElement = button(
    { type: "button" },
    "Okay",
  );
  private readonly _closeButton: HTMLButtonElement = button({
    class: "cancelButton",
    type: "button",
  });
  private readonly _selections: ChannelSelection[];

  public constructor(
    private readonly _doc: SongDocument,
    private readonly _imported: FlpSongImport,
    private readonly _confirm: () => void,
    private readonly _close: () => void,
  ) {
    const defaultSoundFontId: string | null =
      this._doc.song.assets.find(
        (asset: AssetDefinition): boolean => asset.type == "soundFont",
      )?.id ?? null;
    this._selections = _imported.pitchChannels.map((): ChannelSelection => ({
      soundFontId: defaultSoundFontId,
      presetIndex: null,
    }));
    const columns: HTMLDivElement = div(
      { class: "assetsPromptColumns" },
      div(
        { class: "assetsPromptColumn" },
        h3("Imported Channels"),
        this._channelRows,
      ),
      div(
        { class: "assetsPromptColumn pinnedAssetsColumn" },
        h3("Pinned SoundFonts"),
        this._pinnedRows,
      ),
    );
    this.container.append(
      columns,
      div({ class: "button-row" }, this._okayButton),
      this._closeButton,
    );
    this._okayButton.addEventListener("click", this._apply);
    this._closeButton.addEventListener("click", this._close);
    this._doc.synth.assetLoadEvents.addEventListener("change", this._render);
    assetCacheEvents.addEventListener("change", this._render);
    this._render();
  }

  private _render = (): void => {
    this._channelRows.replaceChildren();
    const soundFonts: AssetDefinition[] = this._doc.song.assets.filter(
      (asset: AssetDefinition): boolean => asset.type == "soundFont",
    );
    let canApply: boolean = true;

    for (
      let channelIndex = 0;
      channelIndex < this._imported.pitchChannels.length;
    ) {
      const startChannelIndex: number = channelIndex;
      const source: FlpChannelSource =
        this._imported.channelSources[startChannelIndex]!;
      let endChannelIndex: number = startChannelIndex + 1;
      while (
        endChannelIndex < this._imported.pitchChannels.length &&
        this._imported.channelSources[endChannelIndex]!.sourceChannelId ==
          source.sourceChannelId
      ) {
        endChannelIndex++;
      }
      const selection: ChannelSelection = this._selections[startChannelIndex]!;
      const soundFontSelect: HTMLSelectElement = select(
        {
          "aria-label": `SoundFont for ${this._channelLabel(startChannelIndex, endChannelIndex)}`,
        },
        option({ value: "" }, "No SoundFont"),
      );
      for (const soundFont of soundFonts)
        soundFontSelect.append(option({ value: soundFont.id }, soundFont.name));
      if (
        selection.soundFontId != null &&
        soundFonts.some(
          (asset: AssetDefinition): boolean =>
            asset.id == selection.soundFontId,
        )
      ) {
        soundFontSelect.value = selection.soundFontId;
      } else {
        this._setGroupSelection(startChannelIndex, endChannelIndex, null, null);
      }

      const presetSelect: HTMLSelectElement = select({
        "aria-label": `SoundFont instrument for ${this._channelLabel(startChannelIndex, endChannelIndex)}`,
      });
      if (selection.soundFontId == null) {
        presetSelect.append(option({ value: "" }, "Choose a SoundFont first"));
        presetSelect.disabled = true;
      } else {
        const presets: readonly SoundFontPresetInfo[] | null =
          this._doc.synth.getSoundFontPresets(selection.soundFontId);
        if (presets == null) {
          const status: string | null = this._doc.synth.getAssetLoadStatus(
            selection.soundFontId,
          );
          presetSelect.append(
            option(
              { value: "" },
              status == "error" ? "Failed to load" : "Loading…",
            ),
          );
          presetSelect.disabled = true;
          canApply = false;
        } else if (presets.length == 0) {
          presetSelect.append(option({ value: "" }, "No instruments"));
          presetSelect.disabled = true;
          canApply = false;
        } else {
          for (const preset of presets)
            presetSelect.append(option({ value: preset.index }, preset.name));
          if (
            !presets.some(
              (preset: SoundFontPresetInfo): boolean =>
                preset.index == selection.presetIndex,
            )
          ) {
            this._setGroupSelection(
              startChannelIndex,
              endChannelIndex,
              selection.soundFontId,
              presets[0]!.index,
            );
          }
          presetSelect.value = String(selection.presetIndex);
        }
      }

      soundFontSelect.addEventListener("change", (): void => {
        this._setGroupSelection(
          startChannelIndex,
          endChannelIndex,
          soundFontSelect.value || null,
          null,
        );
        this._render();
      });
      presetSelect.addEventListener("change", (): void => {
        this._setGroupSelection(
          startChannelIndex,
          endChannelIndex,
          selection.soundFontId,
          Number(presetSelect.value),
        );
        this._render();
      });

      const sourceName: string = this._sourceName(source);
      const details: string[] = this._sourceDetails(source);
      this._channelRows.append(
        div(
          { class: "assetCard flpChannelCard" },
          label(
            { class: "assetName" },
            `${this._channelLabel(startChannelIndex, endChannelIndex)}: ${sourceName}`,
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
    this._okayButton.disabled = !canApply;

    this._pinnedRows.replaceChildren();
    const pinnedSoundFonts: AssetDefinition[] = getPinnedAssets().filter(
      (asset: AssetDefinition): boolean => asset.type == "soundFont",
    );
    for (const asset of pinnedSoundFonts) {
      const inserted: boolean = this._doc.song.assets.some(
        (songAsset: AssetDefinition): boolean =>
          songAsset.source == asset.source,
      );
      const insertButton: HTMLButtonElement = button(
        { type: "button" },
        inserted ? "Inserted" : "Insert",
      );
      insertButton.disabled = inserted;
      insertButton.addEventListener("click", (): void =>
        this._insertAsset(asset),
      );
      this._pinnedRows.append(
        div(
          { class: "assetCard compactAssetCard" },
          label({ class: "assetName" }, getAssetName(asset.url)),
          div({ class: "assetControls" }, insertButton),
        ),
      );
    }
    if (pinnedSoundFonts.length == 0)
      this._pinnedRows.append(span("No pinned SoundFonts."));
  };

  private _sourceName(source: FlpChannelSource): string {
    if (source.name != null && source.name.trim() != "") return source.name;
    if (source.plugin?.name != null) return source.plugin.name;
    if (
      source.plugin?.internalName != null &&
      source.plugin.internalName != "Fruity Wrapper"
    )
      return source.plugin.internalName;
    if (source.samplePath != null) return getAssetName(source.samplePath);
    return `FL channel ${source.sourceChannelId + 1}`;
  }

  private _sourceDetails(source: FlpChannelSource): string[] {
    const details: string[] = [];
    const pluginName: string | undefined =
      source.plugin?.name ?? source.plugin?.internalName;
    if (pluginName != null) {
      details.push(
        source.plugin?.vendor == null
          ? pluginName
          : `${pluginName} by ${source.plugin.vendor}`,
      );
    }
    if (source.plugin?.statePath != null)
      details.push(getAssetName(source.plugin.statePath));
    const stateFileBaseName: string = getAssetName(
      source.plugin?.statePath ?? "",
    ).replace(/\.[^.]+$/, "");
    if (
      source.plugin?.statePreset != null &&
      source.plugin.statePreset != stateFileBaseName
    )
      details.push(source.plugin.statePreset);
    if (source.samplePath != null)
      details.push(`Sample: ${getAssetName(source.samplePath)}`);
    return details;
  }

  private _channelLabel(
    startChannelIndex: number,
    endChannelIndex: number,
  ): string {
    const start: number = startChannelIndex + 1;
    const end: number = endChannelIndex;
    return start == end ? `Channel ${start}` : `Channels ${start}-${end}`;
  }

  private _setGroupSelection(
    startChannelIndex: number,
    endChannelIndex: number,
    soundFontId: string | null,
    presetIndex: number | null,
  ): void {
    for (
      let channelIndex = startChannelIndex;
      channelIndex < endChannelIndex;
      channelIndex++
    ) {
      const selection: ChannelSelection = this._selections[channelIndex]!;
      selection.soundFontId = soundFontId;
      selection.presetIndex = presetIndex;
    }
  }

  private _insertAsset(asset: AssetDefinition): void {
    if (
      this._doc.song.assets.some(
        (songAsset: AssetDefinition): boolean =>
          songAsset.source == asset.source,
      )
    )
      return;
    const isFirstSoundFont: boolean =
      asset.type == "soundFont" &&
      !this._doc.song.assets.some(
        (songAsset: AssetDefinition): boolean => songAsset.type == "soundFont",
      );
    this._doc.record(
      new ChangeAssets(this._doc, [...this._doc.song.assets, asset]),
    );
    if (isFirstSoundFont)
      this._setGroupSelection(0, this._selections.length, asset.id, null);
    this._render();
  }

  private _apply = (): void => {
    for (
      let channelIndex = 0;
      channelIndex < this._selections.length;
      channelIndex++
    ) {
      const selection: ChannelSelection = this._selections[channelIndex]!;
      if (selection.soundFontId == null || selection.presetIndex == null)
        continue;
      const preset: SoundFontPresetInfo | undefined = this._doc.synth
        .getSoundFontPresets(selection.soundFontId)
        ?.find(
          (candidate: SoundFontPresetInfo): boolean =>
            candidate.index == selection.presetIndex,
        );
      if (preset == null) return;
      applySoundFontPreset(
        this._imported.pitchChannels[channelIndex]!.instruments[0]!,
        selection.soundFontId,
        preset,
        this._imported.tempo,
        false,
      );
    }
    this._confirm();
  };

  public cleanUp = (): void => {
    this._okayButton.removeEventListener("click", this._apply);
    this._closeButton.removeEventListener("click", this._close);
    this._doc.synth.assetLoadEvents.removeEventListener("change", this._render);
    assetCacheEvents.removeEventListener("change", this._render);
  };
}
