// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";

import type { Prompt } from "./prompt.js";

const { button, dialog, div, h2, h3, input } = HTML;

export interface TabbedSearchablePromptPage {
  readonly name: string;
  readonly content: HTMLElement;
}

export class TabbedSearchablePrompt implements Prompt {
  readonly #pages: readonly TabbedSearchablePromptPage[];
  readonly #close: () => void;
  readonly #search: HTMLInputElement = input({
    class: "tabbedSearchablePromptSearch",
    type: "search",
    placeholder: "Search",
    "aria-label": "Search",
  });
  readonly #tabs: HTMLDivElement = div({
    class: "tabbedSearchablePromptTabs",
    role: "tablist",
  });
  readonly #pageContent: HTMLDivElement = div({
    class: "tabbedSearchablePromptPages",
  });
  readonly #cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
    type: "button",
    "aria-label": "Close",
  });
  readonly #tabButtons: HTMLButtonElement[] = [];
  #selectedPage = "All";

  public readonly container: HTMLDialogElement;

  public constructor(
    title: string,
    _pages: readonly TabbedSearchablePromptPage[],
    _close: () => void,
    initialPage = "All",
  ) {
    this.#pages = _pages;
    this.#close = _close;
    this.#selectedPage =
      initialPage === "All" || this.#pages.some((page) => page.name === initialPage)
        ? initialPage
        : "All";
    this.container = dialog(
      { class: "prompt noSelection tabbedSearchablePrompt" },
      h2(title),
      this.#search,
      div({ class: "tabbedSearchablePromptBody" }, this.#tabs, this.#pageContent),
      this.#cancelButton,
    );

    this.#addTab("All");
    for (const page of this.#pages) {
      this.#addTab(page.name);
    }

    this.#search.addEventListener("input", this.#render);
    this.#tabs.addEventListener("click", this.#whenTabClicked);
    this.#cancelButton.addEventListener("click", this.#close);
    this.#render();
    setTimeout(() => this.#search.focus(), 0);
  }

  #addTab(name: string): void {
    const tab: HTMLButtonElement = button(
      {
        class: "variableNameButton",
        type: "button",
        role: "tab",
        "data-page": name,
      },
      name,
    );
    this.#tabButtons.push(tab);
    this.#tabs.append(tab);
  }

  #whenTabClicked = (event: MouseEvent): void => {
    const target: Element | null =
      event.target instanceof Element ? event.target.closest("button[data-page]") : null;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    this.#selectedPage = target.dataset["page"] ?? "All";
    this.#render();
  };

  #render = (): void => {
    const query: string = this.#search.value.trim().toLocaleLowerCase(),
      itemMatches: boolean[][] = this.#pages.map((page) =>
        Array.from(page.content.children).map((item) => {
          const matches: boolean =
            query === "" || (item.textContent ?? "").toLocaleLowerCase().includes(query);
          (item as HTMLElement).hidden = !matches;
          return matches;
        }),
      ),
      pageMatches: boolean[] = this.#pages.map(
        (page, pageIndex) =>
          page.name.toLocaleLowerCase().includes(query) ||
          itemMatches[pageIndex]!.some((matches) => matches),
      );

    for (let i = 0; i < this.#tabButtons.length; i++) {
      const tab: HTMLButtonElement = this.#tabButtons[i]!,
        isAll: boolean = i === 0;
      tab.hidden = !isAll && !pageMatches[i - 1]!;
    }
    if (this.#selectedPage !== "All") {
      const selectedIndex: number = this.#pages.findIndex(
        (page) => page.name === this.#selectedPage,
      );
      if (selectedIndex === -1 || !pageMatches[selectedIndex]!) {
        this.#selectedPage = "All";
      }
    }

    for (const tab of this.#tabButtons) {
      const selected: boolean = tab.dataset["page"] === this.#selectedPage;
      tab.classList.toggle("selected", selected);
      tab.setAttribute("aria-selected", String(selected));
    }

    this.#pageContent.replaceChildren();
    for (let pageIndex = 0; pageIndex < this.#pages.length; pageIndex++) {
      const page: TabbedSearchablePromptPage = this.#pages[pageIndex]!;
      if (this.#selectedPage !== "All" && this.#selectedPage !== page.name) {
        continue;
      }
      if (!itemMatches[pageIndex]!.some((matches) => matches)) {
        continue;
      }

      this.#pageContent.append(
        div({ class: "tabbedSearchablePromptPage" }, h3(page.name), page.content),
      );
    }
  };

  public cleanUp = (): void => {
    this.#search.removeEventListener("input", this.#render);
    this.#tabs.removeEventListener("click", this.#whenTabClicked);
    this.#cancelButton.removeEventListener("click", this.#close);
  };
}
