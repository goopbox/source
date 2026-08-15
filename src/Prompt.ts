// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export interface Prompt {
  container: HTMLDialogElement;
  cleanUp: () => void;
  /** Whether opening this prompt should pause active song playback. Defaults to true. */
  pausePlayback?: boolean;
}

const _closeHandlers: WeakMap<Prompt, () => void> = new WeakMap();

export function mountPrompt(
  prompt: Prompt,
  parent: HTMLElement,
  closeHandler: () => void,
): void {
  unmountPromptCloseHandler(prompt);
  _closeHandlers.set(prompt, closeHandler);
  prompt.container.addEventListener("cancel", closeHandler);
  prompt.container.addEventListener("close", closeHandler);
  parent.appendChild(prompt.container);
  prompt.container.showModal();
}

export function unmountPrompt(prompt: Prompt, parent: HTMLElement): void {
  unmountPromptCloseHandler(prompt);
  if (prompt.container.open) prompt.container.close();
  if (prompt.container.parentElement == parent)
    parent.removeChild(prompt.container);
  prompt.cleanUp();
}

function unmountPromptCloseHandler(prompt: Prompt): void {
  const closeHandler: (() => void) | undefined = _closeHandlers.get(prompt);
  if (closeHandler == undefined) return;
  prompt.container.removeEventListener("cancel", closeHandler);
  prompt.container.removeEventListener("close", closeHandler);
  _closeHandlers.delete(prompt);
}
