// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import type { EventRange } from "./EventEditing.js";

export type AutomationRowSelection = EventRange;

/** Transient Automation editor state. A time selection belongs to one row. */
export class AutomationRowSelectionState {
  private _activeRow: number = 0;
  private _range: AutomationRowSelection | null = null;

  public get activeRow(): number {
    return this._activeRow;
  }

  public set activeRow(rowIndex: number) {
    if (rowIndex != this._activeRow) this._range = null;
    this._activeRow = rowIndex;
  }

  public setRange(rowIndex: number, start: number, end: number): void {
    this.activeRow = rowIndex;
    const rangeStart: number = Math.min(start, end);
    const rangeEnd: number = Math.max(start, end);
    if (rangeStart == rangeEnd) {
      this._range = null;
    } else {
      this._range = { start: rangeStart, end: rangeEnd };
    }
  }

  public getRange(rowIndex: number): AutomationRowSelection | null {
    return rowIndex == this._activeRow ? this._range : null;
  }

  public clearRange(rowIndex: number): void {
    if (rowIndex == this._activeRow) this._range = null;
  }

  public clearRanges(): void {
    this._range = null;
  }

  public rangeRows(): number[] {
    return this._range == null ? [] : [this._activeRow];
  }

  public contains(rowIndex: number, part: number): boolean {
    return rowIndex == this._activeRow &&
      this._range != null &&
      this._range.start <= part &&
      part <= this._range.end;
  }

  public trim(
    rowCount: number,
    partsPerBar: number = Number.POSITIVE_INFINITY,
  ): void {
    if (this._activeRow < 0 || this._activeRow >= rowCount) {
      this._range = null;
    }
    this._activeRow = Math.max(0, Math.min(rowCount - 1, this._activeRow));
    if (this._range != null) {
      const start: number = Math.max(0, Math.min(partsPerBar, this._range.start));
      const end: number = Math.max(0, Math.min(partsPerBar, this._range.end));
      this._range = start < end ? { start, end } : null;
    }
  }
}
