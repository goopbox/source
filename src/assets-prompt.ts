// Distributed under the Unlicense.

import { type AssetDefinition, getAssetName, parseAssetDefinition } from "../synth/synth-config.js";
import { assetCacheEvents, getPinnedAssets, pinAsset, unpinAsset } from "../synth/asset-cache.js";
import { ChangeAssets } from "./changes.js";
import { ColorConfig } from "./color-config.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./prompt.js";
import type { SongDocument } from "./song-document.js";
import { rewritePastedAssetSource } from "./asset-source-paste.js";

const { button, dialog, div, h2, h3, input, label, progress, span } = HTML;

export class AssetsPrompt implements Prompt {
  readonly #doc: SongDocument;
  public readonly container: HTMLDialogElement = dialog(
    { class: "prompt assetsPrompt" },
    h2("Assets"),
  );
  readonly #songRows: HTMLDivElement = div({
    class: "assetsPromptRows",
  });
  readonly #pinnedRows: HTMLDivElement = div({
    class: "assetsPromptRows",
  });
  readonly #search: HTMLInputElement = input({
    class: "assetsPromptSearch",
    type: "search",
    placeholder: "Search",
    "aria-label": "Search",
  });
  readonly #addButton: HTMLButtonElement = button({ type: "button" }, "Add Asset");
  readonly #closeButton: HTMLButtonElement = button({
    class: "cancelButton",
    type: "button",
  });
  readonly #columns: HTMLDivElement = div({
    class: "assetsPromptColumns",
  });
  readonly #loadIndicators = new Map<string, HTMLSpanElement[]>();

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
    this.container.append(this.#search, this.#columns, this.#closeButton);
    this.#addButton.addEventListener("click", this.#addAsset);
    this.#closeButton.addEventListener("click", this.#close);
    this.#search.addEventListener("input", this.#render);
    this.#doc.synth.assetLoadEvents.addEventListener("change", this.#updateLoadIndicators);
    assetCacheEvents.addEventListener("change", this.#render);
    this.#render();
  }

  #matchesSearch(asset: AssetDefinition): boolean {
    const query: string = this.#search.value.trim().toLocaleLowerCase();
    return (
      query === "" ||
      asset.name.toLocaleLowerCase().includes(query) ||
      asset.source.toLocaleLowerCase().includes(query)
    );
  }

  #render = (): void => {
    this.#loadIndicators.clear();
    this.#songRows.replaceChildren();
    let visibleSongAssets = 0;
    const pinnedSources = new Set<string>(
      getPinnedAssets().map((asset: AssetDefinition): string => asset.source),
    );
    for (const asset of this.#doc.song.assets) {
      if (!this.#matchesSearch(asset)) {
        continue;
      }
      visibleSongAssets++;
      const sourceInput: HTMLInputElement = input({
          type: "text",
          value: asset.source,
          placeholder: "https://example.com/asset.wav",
        }),
        index: number = this.#doc.song.assets.indexOf(asset),
        removeButton: HTMLButtonElement = button(
          { type: "button", "aria-label": "Remove asset" },
          "×",
        ),
        upButton: HTMLButtonElement = button(
          { type: "button", "aria-label": "Move asset up" },
          "↑",
        ),
        downButton: HTMLButtonElement = button(
          { type: "button", "aria-label": "Move asset down" },
          "↓",
        ),
        loadIndicator: HTMLSpanElement = span({
          class: "assetLoadIndicator",
        }),
        indicators: HTMLSpanElement[] = this.#loadIndicators.get(asset.id) ?? [];
      indicators.push(loadIndicator);
      this.#loadIndicators.set(asset.id, indicators);
      this.#updateLoadIndicator(asset.id, loadIndicator);
      const controls: HTMLDivElement = div({ class: "assetControls" }, loadIndicator);
      if (!pinnedSources.has(asset.source)) {
        const pinButton: HTMLButtonElement = button({ type: "button" }, "Pin");
        pinButton.addEventListener("click", () => {
          pinAsset(asset);
          this.#render();
        });
        controls.append(pinButton);
      }
      controls.append(upButton, downButton, removeButton);
      const row: HTMLDivElement = div(
        { class: "assetCard" },
        label({ class: "assetName" }, getAssetName(asset.url)),
        sourceInput,
        controls,
      );
      sourceInput.addEventListener("change", () => this.#updateAsset(asset, sourceInput.value));
      sourceInput.addEventListener("paste", (event: ClipboardEvent) => {
        const pasted: string = event.clipboardData?.getData("text") ?? "",
          rewritten: string = rewritePastedAssetSource(pasted);
        if (rewritten === pasted) {
          return;
        }
        event.preventDefault();
        sourceInput.setRangeText(
          rewritten,
          sourceInput.selectionStart ?? sourceInput.value.length,
          sourceInput.selectionEnd ?? sourceInput.value.length,
          "end",
        );
        this.#updateAsset(asset, sourceInput.value);
      });
      removeButton.addEventListener("click", () => this.#removeAsset(asset));
      upButton.disabled = index === 0;
      downButton.disabled = index === this.#doc.song.assets.length - 1;
      upButton.addEventListener("click", () => this.#moveAsset(asset, -1));
      downButton.addEventListener("click", () => this.#moveAsset(asset, 1));
      this.#songRows.append(row);
    }
    if (visibleSongAssets === 0) {
      this.#songRows.append(
        span(this.#doc.song.assets.length === 0 ? "No assets." : "No matching assets."),
      );
    }

    const songColumn: HTMLDivElement = div(
      { class: "assetsPromptColumn songAssetsColumn" },
      h3("Song Assets"),
      this.#songRows,
      this.#addButton,
    );
    this.#columns.replaceChildren(songColumn);
    this.#pinnedRows.replaceChildren();
    const pinnedAssets: AssetDefinition[] = getPinnedAssets();
    let visiblePinnedAssets = 0;
    for (const asset of pinnedAssets) {
      if (!this.#matchesSearch(asset)) {
        continue;
      }
      visiblePinnedAssets++;
      const inserted: boolean = this.#doc.song.assets.some(
          (songAsset: AssetDefinition): boolean => songAsset.source === asset.source,
        ),
        unpinButton: HTMLButtonElement = button({ type: "button" }, "Unpin"),
        controls: HTMLDivElement = div({ class: "assetControls" }, unpinButton);
      if (!inserted) {
        const insertButton: HTMLButtonElement = button({ type: "button" }, "Insert");
        insertButton.addEventListener("click", () => this.#insertAsset(asset));
        controls.prepend(insertButton);
      }
      unpinButton.addEventListener("click", () => {
        unpinAsset(asset);
        this.#render();
      });
      this.#pinnedRows.append(
        div(
          { class: "assetCard compactAssetCard" },
          label({ class: "assetName" }, getAssetName(asset.url)),
          controls,
        ),
      );
    }
    if (visiblePinnedAssets === 0) {
      this.#pinnedRows.append(
        span(pinnedAssets.length === 0 ? "No pinned assets." : "No matching assets."),
      );
    }
    this.#columns.append(
      div(
        { class: "assetsPromptColumn pinnedAssetsColumn" },
        h3("Pinned Assets"),
        this.#pinnedRows,
      ),
    );
  };

  #updateLoadIndicator(assetId: string, indicator: HTMLSpanElement): void {
    const loadStatus: string | null = this.#doc.synth.getAssetLoadStatus(assetId);
    if (loadStatus === "loading") {
      const loadingBar: HTMLProgressElement = progress({
          class: "assetLoadProgress",
          max: "1",
        }),
        downloadProgress: number | null = this.#doc.synth.getAssetLoadProgress(assetId);
      if (downloadProgress != null) {
        loadingBar.value = downloadProgress;
      }
      indicator.replaceChildren(loadingBar);
    } else if (loadStatus === "error") {
      indicator.replaceChildren(
        span(
          { class: "assetError", style: `color: ${ColorConfig.error};` },
          `Error: ${this.#doc.synth.getAssetLoadError(assetId) ?? "Unknown error"}`,
        ),
      );
    } else {
      indicator.replaceChildren();
    }
  }

  #updateLoadIndicators = (): void => {
    for (const [assetId, indicators] of this.#loadIndicators) {
      for (const indicator of indicators) {
        this.#updateLoadIndicator(assetId, indicator);
      }
    }
  };

  #addAsset = (): void => {
    const asset: AssetDefinition | null = parseAssetDefinition("https://");
    if (asset == null) {
      return;
    }
    this.#record([...this.#doc.song.assets, asset]);
    this.#render();
    this.#songRows.scrollTop = this.#songRows.scrollHeight;
  };

  #insertAsset(asset: AssetDefinition): void {
    if (
      this.#doc.song.assets.some(
        (songAsset: AssetDefinition): boolean => songAsset.source === asset.source,
      )
    ) {
      return;
    }
    this.#record([...this.#doc.song.assets, asset]);
    this.#render();
  }

  #updateAsset(asset: AssetDefinition, source: string): void {
    const replacement: AssetDefinition | null = parseAssetDefinition(source);
    if (replacement == null) {
      return;
    }
    const index: number = this.#doc.song.assets.indexOf(asset);
    if (index === -1) {
      return;
    }
    const scrollTop: number = this.#songRows.scrollTop,
      assets: AssetDefinition[] = [...this.#doc.song.assets];
    assets[index] = replacement;
    this.#record(assets);
    this.#render();
    this.#songRows.scrollTop = scrollTop;
  }

  #removeAsset = (asset: AssetDefinition): void => {
    const index: number = this.#doc.song.assets.indexOf(asset);
    if (index === -1) {
      return;
    }
    const assets: AssetDefinition[] = [...this.#doc.song.assets];
    assets.splice(index, 1);
    this.#record(assets);
    this.#render();
  };

  #moveAsset = (asset: AssetDefinition, direction: number): void => {
    const index: number = this.#doc.song.assets.indexOf(asset),
      target: number = index + direction;
    if (index === -1 || target < 0 || target >= this.#doc.song.assets.length) {
      return;
    }
    const assets: AssetDefinition[] = [...this.#doc.song.assets];
    [assets[index], assets[target]] = [assets[target]!, assets[index]!];
    this.#record(assets);
    this.#render();
  };

  #record(assets: readonly AssetDefinition[]): void {
    this.#doc.record(new ChangeAssets(this.#doc, assets));
  }

  #close = (): void => this.#doc.closePrompt();
  public cleanUp = (): void => {
    this.#addButton.removeEventListener("click", this.#addAsset);
    this.#closeButton.removeEventListener("click", this.#close);
    this.#search.removeEventListener("input", this.#render);
    this.#doc.synth.assetLoadEvents.removeEventListener("change", this.#updateLoadIndicators);
    assetCacheEvents.removeEventListener("change", this.#render);
  };
}
