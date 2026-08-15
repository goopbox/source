// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export class Layout {
  public static setLayout(layout: string): void {
    document.documentElement.dataset["layout"] =
      layout === "tall" ? "tall" : "long";
  }
}
