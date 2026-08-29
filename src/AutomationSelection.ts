// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import type { EventRange } from "./EventEditing.js";

export type AutomationRowSelection = EventRange;

/** Transient Automation editor state. Each row keeps its own time selection. */
export class AutomationRowSelectionState {
  public activeRow: number = 0;
  private readonly _ranges: Map<number, AutomationRowSelection> = new Map();

  public setRange(rowIndex: number, start: number, end: number): void {
    this.activeRow = rowIndex;
    const rangeStart: number = Math.min(start, end);
    const rangeEnd: number = Math.max(start, end);
    if (rangeStart == rangeEnd) {
      this._ranges.delete(rowIndex);
    } else {
      this._ranges.set(rowIndex, { start: rangeStart, end: rangeEnd });
    }
  }

  public getRange(rowIndex: number): AutomationRowSelection | null {
    return this._ranges.get(rowIndex) ?? null;
  }

  public clearRange(rowIndex: number): void {
    this._ranges.delete(rowIndex);
  }

  public clearRanges(): void {
    this._ranges.clear();
  }

  public rangeRows(): number[] {
    return Array.from(this._ranges.keys()).sort((a, b) => a - b);
  }

  public contains(rowIndex: number, part: number): boolean {
    const range: AutomationRowSelection | undefined = this._ranges.get(rowIndex);
    return range != undefined && range.start <= part && part <= range.end;
  }

  public trim(
    rowCount: number,
    partsPerBar: number = Number.POSITIVE_INFINITY,
  ): void {
    for (const [rowIndex, range] of this._ranges) {
      if (rowIndex >= rowCount) {
        this._ranges.delete(rowIndex);
        continue;
      }
      const start: number = Math.max(0, Math.min(partsPerBar, range.start));
      const end: number = Math.max(0, Math.min(partsPerBar, range.end));
      if (start >= end) this._ranges.delete(rowIndex);
      else this._ranges.set(rowIndex, { start, end });
    }
    this.activeRow = Math.max(0, Math.min(rowCount - 1, this.activeRow));
  }
}
