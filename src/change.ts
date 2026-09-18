// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export class Change {
  #noop = true;

  protected _didSomething(): void {
    this.#noop = false;
  }

  public isNoop(): boolean {
    return this.#noop;
  }

  public commit(): void {}
}

export class UndoableChange extends Change {
  #reversed: boolean;
  #doneForwards: boolean;
  public constructor(reversed: boolean) {
    super();
    this.#reversed = reversed;
    this.#doneForwards = !reversed;
  }

  public undo(): void {
    if (this.#reversed) {
      this._doForwards();
      this.#doneForwards = true;
    } else {
      this._doBackwards();
      this.#doneForwards = false;
    }
  }

  public redo(): void {
    if (this.#reversed) {
      this._doBackwards();
      this.#doneForwards = false;
    } else {
      this._doForwards();
      this.#doneForwards = true;
    }
  }

  // IsDoneForwards() returns whether or not the Change was most recently
  // Performed forwards or backwards. If the change created something, do not
  // Delete it in the change destructor unless the Change was performed
  // Backwards:
  protected _isDoneForwards(): boolean {
    return this.#doneForwards;
  }

  protected _doForwards(): void {
    throw new Error("Change.doForwards(): Override me.");
  }

  protected _doBackwards(): void {
    throw new Error("Change.doBackwards(): Override me.");
  }
}

export class ChangeGroup extends Change {
  public append(change: Change): void {
    if (change.isNoop()) {
      return;
    }
    this._didSomething();
  }
}

export class ChangeSequence extends UndoableChange {
  #changes: UndoableChange[];
  public constructor(changes?: UndoableChange[]) {
    super(false);
    if (changes === undefined) {
      this.#changes = [];
    } else {
      this.#changes = changes.concat();
    }
  }

  public append(change: UndoableChange): void {
    if (change.isNoop()) {
      return;
    }
    this.#changes[this.#changes.length] = change;
    this._didSomething();
  }

  protected override _doForwards(): void {
    for (let i = 0; i < this.#changes.length; i++) {
      this.#changes[i]!.redo();
    }
  }

  protected override _doBackwards(): void {
    for (let i: number = this.#changes.length - 1; i >= 0; i--) {
      this.#changes[i]!.undo();
    }
  }
}
