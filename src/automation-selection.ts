// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import type { EventRange } from "./event-editing.js";

export type AutomationRowSelection = EventRange;

/** Transient Automation editor state. A time selection belongs to one row. */
export class AutomationRowSelectionState {
  #activeRow = 0;
  #range: AutomationRowSelection | null = null;

  public get activeRow(): number {
    return this.#activeRow;
  }

  public set activeRow(rowIndex: number) {
    if (rowIndex !== this.#activeRow) {
      this.#range = null;
    }
    this.#activeRow = rowIndex;
  }

  public setRange(rowIndex: number, start: number, end: number): void {
    this.activeRow = rowIndex;
    const rangeStart: number = Math.min(start, end),
      rangeEnd: number = Math.max(start, end);
    if (rangeStart === rangeEnd) {
      this.#range = null;
    } else {
      this.#range = { start: rangeStart, end: rangeEnd };
    }
  }

  public getRange(rowIndex: number): AutomationRowSelection | null {
    return rowIndex === this.#activeRow ? this.#range : null;
  }

  public clearRange(rowIndex: number): void {
    if (rowIndex === this.#activeRow) {
      this.#range = null;
    }
  }

  public clearRanges(): void {
    this.#range = null;
  }

  public rangeRows(): number[] {
    return this.#range == null ? [] : [this.#activeRow];
  }

  public contains(rowIndex: number, part: number): boolean {
    return (
      rowIndex === this.#activeRow &&
      this.#range != null &&
      this.#range.start <= part &&
      part <= this.#range.end
    );
  }

  public trim(rowCount: number, partsPerBar: number = Number.POSITIVE_INFINITY): void {
    if (this.#activeRow < 0 || this.#activeRow >= rowCount) {
      this.#range = null;
    }
    this.#activeRow = Math.max(0, Math.min(rowCount - 1, this.#activeRow));
    if (this.#range != null) {
      const start: number = Math.max(0, Math.min(partsPerBar, this.#range.start)),
        end: number = Math.max(0, Math.min(partsPerBar, this.#range.end));
      this.#range = start < end ? { start, end } : null;
    }
  }
}
