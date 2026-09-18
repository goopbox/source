// Distributed under the Unlicense.

import { EditorConfig, type PresetCategory } from "./editor-config.js";
import {
  TabbedSearchablePrompt,
  type TabbedSearchablePromptPage,
} from "./tabbed-searchable-prompt.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./prompt.js";
import type { SoundFontPresetInfo } from "../synth/synth-controller.js";

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
  readonly #prompt: TabbedSearchablePrompt;
  public readonly container: HTMLDialogElement;
  public readonly pausePlayback = false;

  public constructor(
    isNoise: boolean,
    choose: (preset: string) => void,
    close: () => void,
    samples: readonly SamplePresetInfo[] = [],
    soundFonts: readonly SoundFontPresetGroup[] = [],
    initialPage = "All",
  ) {
    const makeItem = (name: string, value: string): HTMLButtonElement => {
        const item = button({ class: "presetPromptItem", type: "button" }, name);
        item.addEventListener("click", () => {
          choose(value);
          close();
        });
        return item;
      },
      pages: TabbedSearchablePromptPage[] = [
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
        makeItem(preset.name, `soundFont:${encodeURIComponent(soundFont.id)}:${preset.index}`),
      );
      if (items.length > 0) {
        pages.push({
          name: soundFont.name,
          content: div({ class: "promptGrid" }, ...items),
        });
      }
    }
    const categories: {
      category: PresetCategory;
      categoryIndex: number;
    }[] = [];
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
        const hasNoisePresets = category.presets.some((preset) => preset.isNoise === true),
          hasPitchPresets = category.presets.some((preset) => preset.isNoise !== true);
        if (hasNoisePresets === hasPitchPresets) {
          return 1;
        }
        const isNoiseCategory = hasNoisePresets;
        return isNoiseCategory === isNoise ? 0 : 2;
      };
      return priority(a.category) - priority(b.category);
    });
    for (const { category, categoryIndex } of categories) {
      const items: HTMLElement[] = [];
      for (let presetIndex = 0; presetIndex < category.presets.length; presetIndex++) {
        const preset = category.presets[presetIndex]!;
        items.push(makeItem(preset.name, String((categoryIndex << 6) + presetIndex)));
      }
      if (items.length > 0) {
        pages.push({
          name: category.name,
          content: div({ class: "promptGrid" }, ...items),
        });
      }
    }
    this.#prompt = new TabbedSearchablePrompt("Preset", pages, close, initialPage);
    this.container = this.#prompt.container;
  }

  public cleanUp = (): void => this.#prompt.cleanUp();
}
