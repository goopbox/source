// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

/** Transient Automation editor state. Each row keeps its own selected events. */
export class AutomationRowSelectionState {
  public activeRow: number = 0;
  private readonly _selected: Map<number, Set<number>> = new Map();

  public select(rowIndex: number, eventIndex: number, additive: boolean): void {
    this.activeRow = rowIndex;
    let row: Set<number> | undefined = this._selected.get(rowIndex);
    if (row == undefined) {
      row = new Set();
      this._selected.set(rowIndex, row);
    }
    if (!additive) row.clear();
    if (additive && row.has(eventIndex)) row.delete(eventIndex);
    else row.add(eventIndex);
  }

  public selectOnly(rowIndex: number, indexes: readonly number[]): void {
    this.activeRow = rowIndex;
    this._selected.set(rowIndex, new Set(indexes));
  }

  public isSelected(rowIndex: number, eventIndex: number): boolean {
    return this._selected.get(rowIndex)?.has(eventIndex) === true;
  }

  public getSelected(rowIndex: number): number[] {
    return Array.from(this._selected.get(rowIndex) ?? []).sort((a, b) => a - b);
  }

  public rows(): number[] {
    return Array.from(this._selected.keys()).filter(
      (rowIndex: number): boolean =>
        (this._selected.get(rowIndex)?.size ?? 0) > 0,
    );
  }

  public trim(rowCount: number, eventCounts: readonly number[]): void {
    for (const [rowIndex, selected] of this._selected) {
      if (rowIndex >= rowCount) {
        this._selected.delete(rowIndex);
        continue;
      }
      for (const eventIndex of selected) {
        if (eventIndex >= (eventCounts[rowIndex] ?? 0))
          selected.delete(eventIndex);
      }
    }
    this.activeRow = Math.max(0, Math.min(rowCount - 1, this.activeRow));
  }
}
