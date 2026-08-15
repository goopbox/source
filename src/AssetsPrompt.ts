// Distributed under the Unlicense.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import {
  getAssetName,
  parseAssetDefinition,
  type AssetDefinition,
} from "../synth/SynthConfig.js";
import {
  assetCacheEvents,
  getPinnedAssets,
  isAssetCacheEnabled,
  pinAsset,
  unpinAsset,
} from "../synth/AssetCache.js";
import { SongDocument } from "./SongDocument.js";
import { ChangeAssets } from "./changes.js";
import { ColorConfig } from "./ColorConfig.js";
import type { Prompt } from "./Prompt.js";

const { button, dialog, div, h2, h3, input, label, progress, span } = HTML;

export class AssetsPrompt implements Prompt {
  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt assetsPrompt" },
    h2("Assets"),
  );
  private readonly _songRows: HTMLDivElement = div({
    class: "assetsPromptRows",
  });
  private readonly _pinnedRows: HTMLDivElement = div({
    class: "assetsPromptRows",
  });
  private readonly _search: HTMLInputElement = input({
    class: "assetsPromptSearch",
    type: "search",
    placeholder: "Search",
    "aria-label": "Search",
  });
  private readonly _addButton: HTMLButtonElement = button(
    { type: "button" },
    "Add Asset",
  );
  private readonly _closeButton: HTMLButtonElement = button({
    class: "cancelButton",
    type: "button",
  });
  private readonly _columns: HTMLDivElement = div({
    class: "assetsPromptColumns",
  });

  public constructor(private readonly _doc: SongDocument) {
    this.container.append(this._search, this._columns, this._closeButton);
    this._addButton.addEventListener("click", this._addAsset);
    this._closeButton.addEventListener("click", this._close);
    this._search.addEventListener("input", this._render);
    this._doc.synth.assetLoadEvents.addEventListener("change", this._render);
    assetCacheEvents.addEventListener("change", this._render);
    this._render();
  }

  private _matchesSearch(asset: AssetDefinition): boolean {
    const query: string = this._search.value.trim().toLocaleLowerCase();
    return (
      query == "" ||
      asset.name.toLocaleLowerCase().includes(query) ||
      asset.source.toLocaleLowerCase().includes(query)
    );
  }

  private _render = (): void => {
    this._songRows.replaceChildren();
    let visibleSongAssets: number = 0;
    const cacheEnabled: boolean = isAssetCacheEnabled();
    const pinnedSources: Set<string> = new Set(
      getPinnedAssets().map((asset: AssetDefinition): string => asset.source),
    );
    for (const asset of this._doc.song.assets) {
      if (!this._matchesSearch(asset)) continue;
      visibleSongAssets++;
      const sourceInput: HTMLInputElement = input({
        type: "text",
        value: asset.source,
        placeholder: "https://example.com/asset.wav",
      });
      const index: number = this._doc.song.assets.indexOf(asset);
      const removeButton: HTMLButtonElement = button(
        { type: "button", "aria-label": "Remove asset" },
        "×",
      );
      const upButton: HTMLButtonElement = button(
        { type: "button", "aria-label": "Move asset up" },
        "↑",
      );
      const downButton: HTMLButtonElement = button(
        { type: "button", "aria-label": "Move asset down" },
        "↓",
      );
      const controls: HTMLDivElement = div(
        { class: "assetControls" },
        upButton,
        downButton,
        removeButton,
      );
      const loadStatus: string | null = this._doc.synth.getAssetLoadStatus(
        asset.id,
      );
      if (loadStatus == "loading") {
        const loadingBar: HTMLProgressElement = progress({
          class: "assetLoadProgress",
          max: "1",
        });
        const downloadProgress: number | null =
          this._doc.synth.getAssetLoadProgress(asset.id);
        if (downloadProgress != null) loadingBar.value = downloadProgress;
        controls.prepend(loadingBar);
      } else if (loadStatus == "error") {
        controls.prepend(
          span(
            { class: "assetError", style: `color: ${ColorConfig.error};` },
            `Error: ${this._doc.synth.getAssetLoadError(asset.id) ?? "Unknown error"}`,
          ),
        );
      }
      if (cacheEnabled && !pinnedSources.has(asset.source)) {
        const pinButton: HTMLButtonElement = button({ type: "button" }, "Pin");
        pinButton.addEventListener("click", () => {
          pinAsset(asset);
          this._render();
        });
        controls.prepend(pinButton);
      }
      const row: HTMLDivElement = div(
        { class: "assetCard" },
        label({ class: "assetName" }, getAssetName(asset.url)),
        sourceInput,
        controls,
      );
      sourceInput.addEventListener("change", () =>
        this._updateAsset(asset, sourceInput.value),
      );
      removeButton.addEventListener("click", () => this._removeAsset(asset));
      upButton.disabled = index == 0;
      downButton.disabled = index == this._doc.song.assets.length - 1;
      upButton.addEventListener("click", () => this._moveAsset(asset, -1));
      downButton.addEventListener("click", () => this._moveAsset(asset, 1));
      this._songRows.append(row);
    }
    if (visibleSongAssets == 0)
      this._songRows.append(
        span(
          this._doc.song.assets.length == 0
            ? "No assets."
            : "No matching assets.",
        ),
      );

    const songColumn: HTMLDivElement = div(
      { class: "assetsPromptColumn songAssetsColumn" },
      h3("Song Assets"),
      this._songRows,
      this._addButton,
    );
    this._columns.replaceChildren(songColumn);
    if (!cacheEnabled) return;

    this._pinnedRows.replaceChildren();
    const pinnedAssets: AssetDefinition[] = getPinnedAssets();
    let visiblePinnedAssets: number = 0;
    for (const asset of pinnedAssets) {
      if (!this._matchesSearch(asset)) continue;
      visiblePinnedAssets++;
      const inserted: boolean = this._doc.song.assets.some(
        (songAsset: AssetDefinition): boolean =>
          songAsset.source == asset.source,
      );
      const unpinButton: HTMLButtonElement = button(
        { type: "button" },
        "Unpin",
      );
      const controls: HTMLDivElement = div(
        { class: "assetControls" },
        unpinButton,
      );
      if (!inserted) {
        const insertButton: HTMLButtonElement = button(
          { type: "button" },
          "Insert",
        );
        insertButton.addEventListener("click", () => this._insertAsset(asset));
        controls.prepend(insertButton);
      }
      unpinButton.addEventListener("click", () => {
        unpinAsset(asset);
        this._render();
      });
      this._pinnedRows.append(
        div(
          { class: "assetCard compactAssetCard" },
          label({ class: "assetName" }, getAssetName(asset.url)),
          controls,
        ),
      );
    }
    if (visiblePinnedAssets == 0)
      this._pinnedRows.append(
        span(
          pinnedAssets.length == 0
            ? "No pinned assets."
            : "No matching assets.",
        ),
      );
    this._columns.append(
      div(
        { class: "assetsPromptColumn pinnedAssetsColumn" },
        h3("Pinned Assets"),
        this._pinnedRows,
      ),
    );
  };

  private _addAsset = (): void => {
    const asset: AssetDefinition | null = parseAssetDefinition("https://");
    if (asset == null) return;
    this._record([...this._doc.song.assets, asset]);
    this._render();
  };

  private _insertAsset(asset: AssetDefinition): void {
    if (
      this._doc.song.assets.some(
        (songAsset: AssetDefinition): boolean =>
          songAsset.source == asset.source,
      )
    )
      return;
    this._record([...this._doc.song.assets, asset]);
    this._render();
  }

  private _updateAsset(asset: AssetDefinition, source: string): void {
    const replacement: AssetDefinition | null = parseAssetDefinition(source);
    if (replacement == null) return;
    const index: number = this._doc.song.assets.indexOf(asset);
    if (index < 0) return;
    const assets: AssetDefinition[] = [...this._doc.song.assets];
    assets[index] = replacement;
    this._record(assets);
    this._render();
  }

  private _removeAsset = (asset: AssetDefinition): void => {
    const index: number = this._doc.song.assets.indexOf(asset);
    if (index < 0) return;
    const assets: AssetDefinition[] = [...this._doc.song.assets];
    assets.splice(index, 1);
    this._record(assets);
    this._render();
  };

  private _moveAsset = (asset: AssetDefinition, direction: number): void => {
    const index: number = this._doc.song.assets.indexOf(asset);
    const target: number = index + direction;
    if (index < 0 || target < 0 || target >= this._doc.song.assets.length)
      return;
    const assets: AssetDefinition[] = [...this._doc.song.assets];
    [assets[index], assets[target]] = [assets[target]!, assets[index]!];
    this._record(assets);
    this._render();
  };

  private _record(assets: readonly AssetDefinition[]): void {
    this._doc.record(new ChangeAssets(this._doc, assets));
  }

  private _close = (): void => this._doc.closePrompt();
  public cleanUp = (): void => {
    this._addButton.removeEventListener("click", this._addAsset);
    this._closeButton.removeEventListener("click", this._close);
    this._search.removeEventListener("input", this._render);
    this._doc.synth.assetLoadEvents.removeEventListener("change", this._render);
    assetCacheEvents.removeEventListener("change", this._render);
  };
}
