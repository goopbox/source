// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export class ChangeNotifier {
  #validateAndFinalizeState: (() => void) | undefined;
  #watchers: (() => void)[] = [];
  #dirty = false;
  #notifyingWatchers = false;

  // Optionally pass a callback function to be called in response to the dirty flag. This is an
  // Opportunity to clean up potentially internally-inconsistent data before any other watchers
  // Have a chance to respond. This callback is allowed to set the dirty flag again, unlike the
  // Rest of the watchers.
  public constructor(_validateAndFinalizeState?: () => void) {
    this.#validateAndFinalizeState = _validateAndFinalizeState;
  }

  public watch(watcher: () => void): void {
    if (this.#watchers.indexOf(watcher) === -1) {
      this.#watchers.push(watcher);
    }
  }

  // This method isn't used by anything, maybe just delete it?
  public unwatch(watcher: () => void): void {
    if (this.#notifyingWatchers) {
      throw new Error(
        "Attempted to remove a song document change watchers while in the middle of iterating over them.",
      );
    }
    const index: number = this.#watchers.indexOf(watcher);
    if (index !== -1) {
      this.#watchers.splice(index, 1);
    }
  }

  public changed(): void {
    if (this.#notifyingWatchers) {
      console.error(
        "Attempted to mark song document as dirty while in the middle of notifying change watchers.",
      );
    }
    this.#dirty = true;
  }

  public enqueueTaskToNotifyWatchers = (): void => {
    // I intended to enqueue a microtask in the capture phase of a user
    // Input event to render immediately after the handling of the event
    // Finishes. However, I found that Chrome apparently executes microtasks
    // Between the capture and bubble phases for "click" events (but not
    // Other user input events?), which means that changes that occur during
    // The bubbling phase do not get rendered. So now I'm using
    // RequestAnimationFrame instead, which waits a little longer before
    // Executing but it will still happen before the browser updates the
    // Screen.
    //If (self.queueMicrotask) {
    //	Self.queueMicrotask(this.notifyWatchers);
    //} else {
    //	// Fallback for old browsers.
    //	Promise.resolve().then(this.notifyWatchers);
    //}
    window.requestAnimationFrame(this.notifyWatchers);
  };

  public notifyWatchers = (): void => {
    if (!this.#dirty) {
      return;
    }
    if (this.#notifyingWatchers) {
      throw new Error(
        "Attempted to start notifying song document change watchers while in the middle of doing so.",
      );
    }
    this.#validateAndFinalizeState?.();
    this.#dirty = false;
    this.#notifyingWatchers = true;
    try {
      for (const watcher of this.#watchers) {
        watcher();
      }
    } finally {
      this.#notifyingWatchers = false;
    }
    if (this.#dirty) {
      console.error("A song document change watcher marked the document as dirty again.");
    }
  };
}
