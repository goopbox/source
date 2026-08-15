// Distributed under the Unlicense.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import { EditorConfig, type PresetCategory } from "./EditorConfig.js";
import type { SoundFontPresetInfo } from "../synth/SynthController.js";
import {
  TabbedSearchablePrompt,
  type TabbedSearchablePromptPage,
} from "./TabbedSearchablePrompt.js";
import type { Prompt } from "./Prompt.js";

const { button, div } = HTML;

export interface SoundFontPresetGroup {
  readonly id: string;
  readonly name: string;
  readonly presets: readonly SoundFontPresetInfo[];
}

export interface SamplePresetInfo {
  readonly id: string;
  readonly name: string;
}

export class InstrumentPresetPrompt implements Prompt {
  private readonly _prompt: TabbedSearchablePrompt;
  public readonly container: HTMLDialogElement;
  public readonly pausePlayback = false;

  constructor(
    isNoise: boolean,
    choose: (preset: string) => void,
    close: () => void,
    samples: readonly SamplePresetInfo[] = [],
    soundFonts: readonly SoundFontPresetGroup[] = [],
    initialPage: string = "All",
  ) {
    const makeItem = (name: string, value: string): HTMLButtonElement => {
      const item = button({ class: "presetPromptItem", type: "button" }, name);
      item.addEventListener("click", () => {
        choose(value);
        close();
      });
      return item;
    };
    const pages: TabbedSearchablePromptPage[] = [
      {
        name: "Random",
        content: div(
          { class: "promptGrid" },
          makeItem("Preset", "randomPreset"),
          makeItem("Generated", "randomGenerated"),
        ),
      },
    ];
    if (samples.length > 0) {
      pages.push({
        name: "Samples",
        content: div(
          { class: "promptGrid" },
          ...samples.map((sample) =>
            makeItem(sample.name, `sample:${encodeURIComponent(sample.id)}`),
          ),
        ),
      });
    }
    for (const soundFont of soundFonts) {
      const items: HTMLElement[] = soundFont.presets.map((preset) =>
        makeItem(
          preset.name,
          `soundFont:${encodeURIComponent(soundFont.id)}:${preset.index}`,
        ),
      );
      if (items.length > 0)
        pages.push({
          name: soundFont.name,
          content: div({ class: "promptGrid" }, ...items),
        });
    }
    const categories: Array<{
      category: PresetCategory;
      categoryIndex: number;
    }> = [];
    for (
      let categoryIndex = 1;
      categoryIndex < EditorConfig.presetCategories.length;
      categoryIndex++
    ) {
      categories.push({
        category: EditorConfig.presetCategories[categoryIndex]!,
        categoryIndex,
      });
    }
    categories.sort((a, b) => {
      const priority = (category: PresetCategory): number => {
        const hasNoisePresets = category.presets.some(
          (preset) => preset.isNoise === true,
        );
        const hasPitchPresets = category.presets.some(
          (preset) => preset.isNoise !== true,
        );
        if (hasNoisePresets === hasPitchPresets) return 1;
        const isNoiseCategory = hasNoisePresets;
        return isNoiseCategory === isNoise ? 0 : 2;
      };
      return priority(a.category) - priority(b.category);
    });
    for (const { category, categoryIndex } of categories) {
      const items: HTMLElement[] = [];
      for (
        let presetIndex = 0;
        presetIndex < category.presets.length;
        presetIndex++
      ) {
        const preset = category.presets[presetIndex]!;
        items.push(
          makeItem(preset.name, String((categoryIndex << 6) + presetIndex)),
        );
      }
      if (items.length > 0)
        pages.push({
          name: category.name,
          content: div({ class: "promptGrid" }, ...items),
        });
    }
    this._prompt = new TabbedSearchablePrompt(
      "Preset",
      pages,
      close,
      initialPage,
    );
    this.container = this._prompt.container;
  }

  public cleanUp = (): void => this._prompt.cleanUp();
}
