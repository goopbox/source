// Distributed under the Unlicense.

export class RandomBag<T> {
  private _source: readonly T[] = [];
  private _remaining: T[] = [];

  public pick(items: readonly T[]): T {
    if (items.length == 0) throw new Error("Cannot pick from an empty bag.");
    if (
      items.length != this._source.length ||
      items.some((item, index) => item !== this._source[index])
    ) {
      this._source = [...items];
      this._remaining.length = 0;
    }
    if (this._remaining.length == 0) {
      this._remaining = [...this._source];
      for (let i = this._remaining.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [this._remaining[i], this._remaining[j]] = [
          this._remaining[j]!,
          this._remaining[i]!,
        ];
      }
    }
    return this._remaining.pop()!;
  }
}
