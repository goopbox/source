// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  Config,
  type NamedOption,
  type DictionaryArray,
  toNameMap,
} from "../synth/SynthConfig.js";
import { Song } from "../synth/synth.js";
import { HTML, SVG } from "imperative-html/dist/esm/elements-strict.js";

export type ColorGradient = readonly [start: string, end: string];

export interface ChannelColors extends NamedOption {
  readonly secondaryChannel: ColorGradient;
  readonly primaryChannel: ColorGradient;
  readonly secondaryNote: ColorGradient;
  readonly primaryNote: ColorGradient;
}

export interface SvgGradient {
  readonly definition: SVGLinearGradientElement;
  readonly paint: string;
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
  readonly pitchChannels: readonly ColorGradient[];
  readonly noiseChannels: readonly ColorGradient[];
  readonly automationChannels: readonly ColorGradient[];
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
  colors: readonly ColorGradient[],
  channelCount: number,
): string =>
  Array.from({ length: channelCount }, (_, index) => {
    const [start, end] = colors[index % colors.length];
    const name = `--${type}${index + 1}`;
    return [
      `${name}-secondary-channel-start: ${mix(start, "#000", 0.6)};`,
      `${name}-secondary-channel-end: ${mix(end, "#000", 0.6)};`,
      `${name}-primary-channel-start: ${start};`,
      `${name}-primary-channel-end: ${end};`,
      `${name}-secondary-note-start: ${mix(start, "#000", 0.75)};`,
      `${name}-secondary-note-end: ${mix(end, "#000", 0.75)};`,
      `${name}-primary-note-start: ${mix(start, "#fff", 0.45)};`,
      `${name}-primary-note-end: ${mix(end, "#fff", 0.45)};`,
    ].join(" ");
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
    ${channelCss("automation", theme.automationChannels, Config.automationChannelCountMax)}
  }`,
  };
};

export class ColorConfig {
  private static _nextGradientId: number = 0;
  private static readonly _selectGradientText: WeakMap<
    HTMLSelectElement,
    HTMLSpanElement
  > = new WeakMap();

  public static readonly themes: { readonly [name: string]: Theme } = {
    "GoopBox Dark": {
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
      pitchChannels: [
        ["#25f3ff", "#5478ff"],
        ["#ff9752", "#ff4f9a"],
        ["#50ffc9", "#b6ff50"],
        ["#ff98a4", "#ce8bff"],
      ],
      noiseChannels: [
        ["#aaa", "#e0e0e0"],
        ["#da7", "#f0d35f"],
        ["#7ad", "#75e0cf"],
        ["#af82d2", "#e879c1"],
        ["#a2bb77", "#62c596"],
      ],
      automationChannels: [
        ["#e875ff", "#7c8cff"],
        ["#ff6fae", "#ff9a5f"],
        ["#9f8cff", "#59d4ff"],
        ["#65cfff", "#58ffc3"],
      ],
    },
    "BeepBox Dark": {
      background: "#000",
      button: "#444",
      pitchRow: "#444",
      pianoWhiteKey: "#bbb",
      pianoBlackKey: "#444",
      accent: "#74f",
      error: "#ff6b6b",
      text: "#fff",
      blackText: "#000",
      tonic: "#864",
      thirdNote: "#444",
      fifthNote: "#468",
      pitchChannels: [
        ["#25f3ff", "#25f3ff"],
        ["#ffff25", "#ffff25"],
        ["#ff9752", "#ff9752"],
        ["#50ff50", "#50ff50"],
        ["#ff90ff", "#ff90ff"],
        ["#a0a0ff", "#a0a0ff"],
        ["#deff25", "#deff25"],
        ["#ff98a4", "#ff98a4"],
        ["#50ffc9", "#50ffc9"],
        ["#ce8bff", "#ce8bff"],
      ],
      noiseChannels: [
        ["#aaa", "#aaa"],
        ["#da7", "#da7"],
        ["#7ad", "#7ad"],
        ["#af82d2", "#af82d2"],
        ["#a2bb77", "#a2bb77"],
      ],
      automationChannels: [
        ["#e875ff", "#e875ff"],
        ["#ff6fae", "#ff6fae"],
        ["#9f8cff", "#9f8cff"],
        ["#65cfff", "#65cfff"],
      ],
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
    type: "pitch" | "noise" | "automation",
    channelCount: number,
  ): DictionaryArray<ChannelColors> {
    return toNameMap(
      Array.from({ length: channelCount }, (_, index) => {
        const name = `${type}${index + 1}`;
        const gradient = (purpose: string): ColorGradient => [
          `var(--${name}-${purpose}-start)`,
          `var(--${name}-${purpose}-end)`,
        ];
        return {
          name,
          secondaryChannel: gradient("secondary-channel"),
          primaryChannel: gradient("primary-channel"),
          secondaryNote: gradient("secondary-note"),
          primaryNote: gradient("primary-note"),
        };
      }),
    );
  }

  public static cssGradient(colors: ColorGradient): string {
    return `linear-gradient(90deg, ${colors[0]}, ${colors[1]})`;
  }

  public static svgGradient(
    colors: ColorGradient,
    gradientUnits: "objectBoundingBox" | "userSpaceOnUse" = "objectBoundingBox",
    x1: string = "0",
    x2: string = gradientUnits == "objectBoundingBox" ? "1" : "120",
  ): SvgGradient {
    const id: string = `channelGradient${this._nextGradientId++}`;
    return {
      definition: SVG.linearGradient(
        {
          id,
          gradientUnits,
          x1,
          y1: "0",
          x2,
          y2: "0",
        },
        SVG.stop({ offset: "0", "stop-color": colors[0] }),
        SVG.stop({ offset: "1", "stop-color": colors[1] }),
      ),
      paint: `url(#${id})`,
    };
  }

  public static controlGradient(): SvgGradient {
    const gradient: SvgGradient = this.svgGradient(
      [
        "var(--channel-primary-note-start)",
        "var(--channel-primary-note-end)",
      ],
      "userSpaceOnUse",
    );
    gradient.definition.classList.add("channel-control-gradient");
    return gradient;
  }

  public static applyChannelColors(
    container: HTMLElement,
    colors: ChannelColors,
  ): void {
    for (const [name, gradient] of [
      ["secondary-channel", colors.secondaryChannel],
      ["primary-channel", colors.primaryChannel],
      ["secondary-note", colors.secondaryNote],
      ["primary-note", colors.primaryNote],
    ] as const) {
      container.style.setProperty(`--channel-${name}-start`, gradient[0]);
      container.style.setProperty(`--channel-${name}-end`, gradient[1]);
      container.style.setProperty(
        `--channel-${name}`,
        this.cssGradient(gradient),
      );
    }
    container.style.color = colors.primaryNote[0];
    container.classList.add("channel-colors");

    const units: HTMLElement[] = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".selectRow, .instrumentActionRow, .instrument-bar, .settingsGroupTitle, .envelope-row, .envelope-parameter",
      ),
    );
    for (const child of container.children) {
      if (child instanceof HTMLButtonElement) units.push(child);
    }
    for (const unit of units) {
      const bounds: DOMRect = unit.getBoundingClientRect();
      if (bounds.width == 0) continue;
      unit.classList.add("channel-gradient-unit");
      unit.style.setProperty("--channel-gradient-left", `${bounds.left}px`);
      unit.style.setProperty("--channel-gradient-width", `${bounds.width}px`);
      for (const gradient of unit.querySelectorAll<SVGLinearGradientElement>(
        ".channel-control-gradient",
      )) {
        const svg: SVGSVGElement | null = gradient.ownerSVGElement;
        if (svg == null) continue;
        const svgBounds: DOMRect = svg.getBoundingClientRect();
        const viewBoxWidth: number = svg.viewBox.baseVal.width;
        if (svgBounds.width == 0 || viewBoxWidth == 0) continue;
        const scale: number = viewBoxWidth / svgBounds.width;
        gradient.setAttribute("x1", String((bounds.left - svgBounds.left) * scale));
        gradient.setAttribute("x2", String((bounds.right - svgBounds.left) * scale));
      }
    }

    for (const button of container.querySelectorAll("button")) {
      for (const child of Array.from(button.childNodes)) {
        if (
          child.nodeType != Node.TEXT_NODE ||
          child.textContent == null ||
          child.textContent.trim() == ""
        ) continue;
        const text: HTMLSpanElement = HTML.span(
          { class: "channel-gradient-text" },
          child.textContent,
        );
        button.replaceChild(text, child);
      }
    }

    for (const select of container.querySelectorAll("select")) {
      const invalid: boolean = select.classList.contains("invalid-reference");
      select.classList.toggle("channel-gradient-select", !invalid);
      let text: HTMLSpanElement | undefined = this._selectGradientText.get(select);
      if (text == undefined) {
        text = HTML.span({
          class: "channel-gradient-select-text",
          "aria-hidden": "true",
        });
        this._selectGradientText.set(select, text);
        select.parentElement!.insertBefore(text, select);
      }
      text.style.display = invalid ? "none" : "flex";
      text.textContent = select.selectedOptions[0]?.textContent ?? "";
      text.style.opacity = select.disabled ? "0.5" : "";
      const hostBounds: DOMRect = select.parentElement!.getBoundingClientRect();
      const selectBounds: DOMRect = select.getBoundingClientRect();
      text.style.left = `${selectBounds.left - hostBounds.left}px`;
      text.style.top = `${selectBounds.top - hostBounds.top}px`;
      text.style.width = `${selectBounds.width}px`;
      text.style.height = `${selectBounds.height}px`;
    }
  }

  public static readonly pitchChannels: DictionaryArray<ChannelColors> =
    this.makeChannelColors("pitch", Config.pitchChannelCountMax);
  public static readonly noiseChannels: DictionaryArray<ChannelColors> =
    this.makeChannelColors("noise", Config.noiseChannelCountMax);
  public static readonly automationChannels: DictionaryArray<ChannelColors> =
    this.makeChannelColors("automation", Config.automationChannelCountMax);

  public static getChannelColor(song: Song, channel: number): ChannelColors {
    if (song.getChannelIsPitch(channel)) return ColorConfig.pitchChannels[channel];
    if (song.getChannelIsNoise(channel))
      return ColorConfig.noiseChannels[channel - song.pitchChannelCount];
    return ColorConfig.automationChannels[
      channel - song.pitchChannelCount - song.noiseChannelCount
    ];
  }

  private static readonly _styleElement: HTMLStyleElement =
    document.head.appendChild(HTML.style({ type: "text/css" }));

  public static setTheme(name: string): void {
    let theme: Theme = this.themes[name];
    if (theme == undefined) theme = this.themes["GoopBox Dark"];
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
