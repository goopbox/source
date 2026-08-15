// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config } from "../synth/SynthConfig.js";

export function panSettingToPercent(setting: number): number {
  return ((setting - Config.panCenter) * 100) / Config.panCenter;
}

export function panPercentToSetting(percent: number): number {
  const clampedPercent: number = Math.max(-100, Math.min(100, percent));
  return Math.round(
    Config.panCenter + (clampedPercent * Config.panCenter) / 100,
  );
}
