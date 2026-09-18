// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export class Deque<T> {
  #capacity = 1;
  #buffer: (T | undefined)[] = [undefined];
  #mask = 0;
  #offset = 0;
  #count = 0;

  public pushFront(element: T): void {
    if (this.#count >= this.#capacity) {
      this.#expandCapacity();
    }
    this.#offset = (this.#offset - 1) & this.#mask;
    this.#buffer[this.#offset] = element;
    this.#count++;
  }
  public pushBack(element: T): void {
    if (this.#count >= this.#capacity) {
      this.#expandCapacity();
    }
    this.#buffer[(this.#offset + this.#count) & this.#mask] = element;
    this.#count++;
  }
  public popFront(): T {
    if (this.#count <= 0) {
      throw new Error("No elements left to pop.");
    }
    const element: T = this.#buffer[this.#offset] as T;
    this.#buffer[this.#offset] = undefined;
    this.#offset = (this.#offset + 1) & this.#mask;
    this.#count--;
    return element;
  }
  public popBack(): T {
    if (this.#count <= 0) {
      throw new Error("No elements left to pop.");
    }
    this.#count--;
    const index: number = (this.#offset + this.#count) & this.#mask,
      element: T = this.#buffer[index] as T;
    this.#buffer[index] = undefined;
    return element;
  }
  public peakFront(): T {
    if (this.#count <= 0) {
      throw new Error("No elements left to pop.");
    }
    return this.#buffer[this.#offset] as T;
  }
  public peakBack(): T {
    if (this.#count <= 0) {
      throw new Error("No elements left to pop.");
    }
    return this.#buffer[(this.#offset + this.#count - 1) & this.#mask] as T;
  }
  public count(): number {
    return this.#count;
  }
  public set(index: number, element: T): void {
    if (index < 0 || index >= this.#count) {
      throw new Error("Invalid index");
    }
    this.#buffer[(this.#offset + index) & this.#mask] = element;
  }
  public get(index: number): T {
    if (index < 0 || index >= this.#count) {
      throw new Error("Invalid index");
    }
    return this.#buffer[(this.#offset + index) & this.#mask] as T;
  }
  public remove(index: number): void {
    if (index < 0 || index >= this.#count) {
      throw new Error("Invalid index");
    }
    if (index <= this.#count >> 1) {
      while (index > 0) {
        this.set(index, this.get(index - 1));
        index--;
      }
      this.popFront();
    } else {
      index++;
      while (index < this.#count) {
        this.set(index - 1, this.get(index));
        index++;
      }
      this.popBack();
    }
  }
  #expandCapacity(): void {
    if (this.#capacity >= 0x40_00_00_00) {
      throw new Error("Capacity too big.");
    }
    this.#capacity <<= 1;
    const oldBuffer: (T | undefined)[] = this.#buffer,
      newBuffer = new Array<T | undefined>(this.#capacity),
      size: number = this.#count | 0,
      offset: number = this.#offset | 0;
    for (let i = 0; i < size; i++) {
      newBuffer[i] = oldBuffer[(offset + i) & this.#mask];
    }
    for (let i = size; i < this.#capacity; i++) {
      newBuffer[i] = undefined;
    }
    this.#offset = 0;
    this.#buffer = newBuffer;
    this.#mask = this.#capacity - 1;
  }
}
