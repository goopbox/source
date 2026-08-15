// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  Config,
  type NamedOption,
  type DictionaryArray,
  toNameMap,
} from "../synth/SynthConfig.js";
import { Song } from "../synth/synth.js";
import { HTML } from "imperative-html/dist/esm/elements-strict.js";

export interface ChannelColors extends NamedOption {
  readonly secondaryChannel: string;
  readonly primaryChannel: string;
  readonly secondaryNote: string;
  readonly primaryNote: string;
}

interface Theme {
  readonly background: string;
  readonly button: string;
  readonly pitchRow: string;
  readonly pianoWhiteKey: string;
  readonly pianoBlackKey: string;
  readonly accent: string;
  readonly error: string;
  readonly text: string;
  readonly blackText: string;
  readonly tonic: string;
  readonly thirdNote: string;
  readonly fifthNote: string;
  readonly pitchChannels: readonly string[];
  readonly noiseChannels: readonly string[];
}

const mix = (first: string, second: string, firstWeight: number): string => {
  const parse = (color: string): [number, number, number] => {
    const hex = color.slice(1);
    return (
      hex.length == 3
        ? [...hex].map((component) => parseInt(component + component, 16))
        : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((component) =>
            parseInt(component, 16),
          )
    ) as [number, number, number];
  };
  const toLinear = (component: number): number => {
    component /= 255;
    return component <= 0.04045
      ? component / 12.92
      : ((component + 0.055) / 1.055) ** 2.4;
  };
  const toOklab = (
    color: [number, number, number],
  ): [number, number, number] => {
    const [red, green, blue] = color.map(toLinear);
    const lightness = Math.cbrt(
      0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
    );
    const medium = Math.cbrt(
      0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
    );
    const short = Math.cbrt(
      0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
    );
    return [
      0.2104542553 * lightness + 0.793617785 * medium - 0.0040720468 * short,
      1.9779984951 * lightness - 2.428592205 * medium + 0.4505937099 * short,
      0.0259040371 * lightness + 0.7827717662 * medium - 0.808675766 * short,
    ];
  };
  const toSrgb = (component: number): number =>
    255 *
    (component <= 0.0031308
      ? 12.92 * component
      : 1.055 * component ** (1 / 2.4) - 0.055);
  const [red, green, blue] = parse(first);
  if (second == "transparent") {
    return `#${[red, green, blue].map((component) => component.toString(16).padStart(2, "0")).join("")}${Math.round(
      firstWeight * 255,
    )
      .toString(16)
      .padStart(2, "0")}`;
  }
  const firstOklab = toOklab([red, green, blue]);
  const secondOklab = toOklab(parse(second));
  const [lightness, greenRed, blueYellow] = firstOklab.map(
    (component, index) =>
      component * firstWeight + secondOklab[index] * (1 - firstWeight),
  );
  const long =
    (lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow) ** 3;
  const medium =
    (lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow) ** 3;
  const short =
    (lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow) ** 3;
  const [linearRed, linearGreen, linearBlue] = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
  return `#${[linearRed, linearGreen, linearBlue]
    .map((component) =>
      Math.round(Math.min(255, Math.max(0, toSrgb(component))))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

const channelCss = (
  type: string,
  colors: readonly string[],
  channelCount: number,
): string =>
  Array.from({ length: channelCount }, (_, index) => {
    const color = colors[index % colors.length];
    const name = `--${type}${index + 1}`;
    return `${name}-secondary-channel: ${mix(color, "#000", 0.6)}; ${name}-primary-channel: ${color}; ${name}-secondary-note: ${mix(color, "#000", 0.75)}; ${name}-primary-note: ${mix(color, "#fff", 0.45)};`;
  }).join("\n");

const themeCss = (theme: Theme): { css: string; widgetBackground: string } => {
  const widgetBackground = theme.button;
  return {
    widgetBackground,
    css: `:root {
    --background: ${theme.background};
    --text: ${theme.text};
    --black-text: ${theme.blackText};
    --accent: ${theme.accent};
    --error: ${theme.error};
    --disabled-loop: ${mix(theme.accent, theme.background, 0.5)};
    --secondary-text: ${mix(theme.text, theme.background, 0.6)};
    --text-selection: ${mix(theme.accent, "transparent", 0.8)};
    --box-selection-fill: ${mix(theme.text, "transparent", 0.2)};
    --link-accent: ${mix(theme.accent, theme.text, 0.75)};
    --button-background: ${theme.button};
    --button-hover: ${mix(theme.button, theme.text, 0.82)};
    --ui-widget-background: ${widgetBackground};
    --surface: ${mix(theme.background, widgetBackground, 0.65)};
    --ui-widget-hover: ${mix(widgetBackground, theme.text, 0.82)};
    --ui-widget-focus: ${mix(widgetBackground, theme.text, 0.62)};
    --pitch-row: ${theme.pitchRow};
    --white-piano-key: ${theme.pianoWhiteKey};
    --black-piano-key: ${theme.pianoBlackKey};
    --tonic: ${theme.tonic};
    --third-note: ${theme.thirdNote};
    --fifth-note: ${theme.fifthNote};
    ${channelCss("pitch", theme.pitchChannels, Config.pitchChannelCountMax)}
    ${channelCss("noise", theme.noiseChannels, Config.noiseChannelCountMax)}
  }`,
  };
};

export class ColorConfig {
  public static readonly themes: { readonly [name: string]: Theme } = {
    "dark classic": {
      background: "#03040f",
      button: "#22334f",
      pitchRow: "#1c2433",
      pianoWhiteKey: "#91afc7",
      pianoBlackKey: "#22334f",
      accent: "#98dbed",
      error: "#ff6b6b",
      text: "#e1eaf0",
      blackText: "#000",
      tonic: "#3e588c",
      thirdNote: "#2e3663",
      fifthNote: "#224f63",
      pitchChannels: ["#25f3ff", "#ff9752", "#50ffc9", "#ff98a4"],
      noiseChannels: ["#aaa", "#da7", "#7ad", "#af82d2", "#a2bb77"],
    },
  };

  public static readonly background: string = "var(--background)";
  public static readonly text: string = "var(--text)";
  public static readonly blackText: string = "var(--black-text)";
  public static readonly secondaryText: string = "var(--secondary-text)";
  public static readonly textSelection: string = "var(--text-selection)";
  public static readonly boxSelectionFill: string = "var(--box-selection-fill)";
  public static readonly accent: string = "var(--accent)";
  public static readonly error: string = "var(--error)";
  public static readonly disabledLoop: string = "var(--disabled-loop)";
  public static readonly linkAccent: string = "var(--link-accent)";
  public static readonly uiWidgetBackground: string =
    "var(--ui-widget-background)";
  public static readonly surface: string = "var(--surface)";
  public static readonly uiWidgetFocus: string = "var(--ui-widget-focus)";
  public static readonly pitchRow: string = "var(--pitch-row)";
  public static readonly tonic: string = "var(--tonic)";
  public static readonly thirdNote: string = "var(--third-note)";
  public static readonly fifthNote: string = "var(--fifth-note)";
  public static readonly whitePianoKey: string = "var(--white-piano-key)";
  public static readonly blackPianoKey: string = "var(--black-piano-key)";

  private static makeChannelColors(
    type: "pitch" | "noise",
    channelCount: number,
  ): DictionaryArray<ChannelColors> {
    return toNameMap(
      Array.from({ length: channelCount }, (_, index) => {
        const name = `${type}${index + 1}`;
        return {
          name,
          secondaryChannel: `var(--${name}-secondary-channel)`,
          primaryChannel: `var(--${name}-primary-channel)`,
          secondaryNote: `var(--${name}-secondary-note)`,
          primaryNote: `var(--${name}-primary-note)`,
        };
      }),
    );
  }

  public static readonly pitchChannels: DictionaryArray<ChannelColors> =
    this.makeChannelColors("pitch", Config.pitchChannelCountMax);
  public static readonly noiseChannels: DictionaryArray<ChannelColors> =
    this.makeChannelColors("noise", Config.noiseChannelCountMax);

  public static getChannelColor(song: Song, channel: number): ChannelColors {
    return channel < song.pitchChannelCount
      ? ColorConfig.pitchChannels[channel]
      : ColorConfig.noiseChannels[channel - song.pitchChannelCount];
  }

  private static readonly _styleElement: HTMLStyleElement =
    document.head.appendChild(HTML.style({ type: "text/css" }));

  public static setTheme(name: string): void {
    let theme: Theme = this.themes[name];
    if (theme == undefined) theme = this.themes["dark classic"];
    const { css, widgetBackground } = themeCss(theme);

    // Native select pickers may be rendered outside the DOM tree and, unlike
    // the closed control, do not reliably resolve custom properties. Give them
    // the already computed theme colors.
    this._styleElement.textContent = `${css}
			.app select {
				background-color: ${widgetBackground};
			}
			.app select option, .app select optgroup {
				background-color: ${widgetBackground};
				color: ${theme.text};
			}
		`;

    const themeColor = <HTMLMetaElement>(
      document.querySelector("meta[name='theme-color']")
    );
    if (themeColor != null) {
      themeColor.setAttribute("content", widgetBackground);
    }
  }
}
