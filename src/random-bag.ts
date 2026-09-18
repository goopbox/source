// Distributed under the Unlicense.

export class RandomBag<T> {
  #source: readonly T[] = [];
  #remaining: T[] = [];

  public pick(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty bag.");
    }
    if (
      items.length !== this.#source.length ||
      items.some((item, index) => item !== this.#source[index]!)
    ) {
      this.#source = [...items];
      this.#remaining.length = 0;
    }
    if (this.#remaining.length === 0) {
      this.#remaining = [...this.#source];
      for (let i = this.#remaining.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [this.#remaining[i], this.#remaining[j]] = [this.#remaining[j]!, this.#remaining[i]!];
      }
    }
    return this.#remaining.pop()!;
  }
}
