// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { ChannelKind } from "../synth/synth.js";

export function trackChannelKindsAreCompatible(
  source: ChannelKind,
  destination: ChannelKind,
): boolean {
  return source == destination;
}
