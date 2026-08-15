// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { HTML } from "imperative-html/dist/esm/elements-strict.js";
import type { Prompt } from "./Prompt.js";

const { button, dialog, div, h2, h3, input } = HTML;

export interface TabbedSearchablePromptPage {
  readonly name: string;
  readonly content: HTMLElement;
}

export class TabbedSearchablePrompt implements Prompt {
  private readonly _search: HTMLInputElement = input({
    class: "tabbedSearchablePromptSearch",
    type: "search",
    placeholder: "Search",
    "aria-label": "Search",
  });
  private readonly _tabs: HTMLDivElement = div({
    class: "tabbedSearchablePromptTabs",
    role: "tablist",
  });
  private readonly _pageContent: HTMLDivElement = div({
    class: "tabbedSearchablePromptPages",
  });
  private readonly _cancelButton: HTMLButtonElement = button({
    class: "cancelButton",
    type: "button",
    "aria-label": "Close",
  });
  private readonly _tabButtons: HTMLButtonElement[] = [];
  private _selectedPage: string = "All";

  public readonly container: HTMLDialogElement;

  constructor(
    title: string,
    private readonly _pages: ReadonlyArray<TabbedSearchablePromptPage>,
    private readonly _close: () => void,
    initialPage: string = "All",
  ) {
    this._selectedPage =
      initialPage == "All" ||
      this._pages.some((page) => page.name == initialPage)
        ? initialPage
        : "All";
    this.container = dialog(
      { class: "prompt noSelection tabbedSearchablePrompt" },
      h2(title),
      this._search,
      div(
        { class: "tabbedSearchablePromptBody" },
        this._tabs,
        this._pageContent,
      ),
      this._cancelButton,
    );

    this._addTab("All");
    for (const page of this._pages) this._addTab(page.name);

    this._search.addEventListener("input", this._render);
    this._tabs.addEventListener("click", this._whenTabClicked);
    this._cancelButton.addEventListener("click", this._close);
    this._render();
    setTimeout(() => this._search.focus());
  }

  private _addTab(name: string): void {
    const tab: HTMLButtonElement = button(
      {
        class: "variableNameButton",
        type: "button",
        role: "tab",
        "data-page": name,
      },
      name,
    );
    this._tabButtons.push(tab);
    this._tabs.appendChild(tab);
  }

  private _whenTabClicked = (event: MouseEvent): void => {
    const target: Element | null =
      event.target instanceof Element
        ? event.target.closest("button[data-page]")
        : null;
    if (!(target instanceof HTMLButtonElement)) return;
    this._selectedPage = target.dataset["page"] ?? "All";
    this._render();
  };

  private _render = (): void => {
    const query: string = this._search.value.trim().toLocaleLowerCase();
    const itemMatches: boolean[][] = this._pages.map((page) => {
      return Array.from(page.content.children).map((item) => {
        const matches: boolean =
          query == "" ||
          (item.textContent ?? "").toLocaleLowerCase().includes(query);
        (item as HTMLElement).hidden = !matches;
        return matches;
      });
    });
    const pageMatches: boolean[] = this._pages.map((page, pageIndex) => {
      return (
        page.name.toLocaleLowerCase().includes(query) ||
        itemMatches[pageIndex]!.some((matches) => matches)
      );
    });

    for (let i: number = 0; i < this._tabButtons.length; i++) {
      const tab: HTMLButtonElement = this._tabButtons[i]!;
      const isAll: boolean = i == 0;
      tab.hidden = !isAll && !pageMatches[i - 1];
    }
    if (this._selectedPage != "All") {
      const selectedIndex: number = this._pages.findIndex(
        (page) => page.name == this._selectedPage,
      );
      if (selectedIndex == -1 || !pageMatches[selectedIndex])
        this._selectedPage = "All";
    }

    for (const tab of this._tabButtons) {
      const selected: boolean = tab.dataset["page"] == this._selectedPage;
      tab.classList.toggle("selected", selected);
      tab.setAttribute("aria-selected", String(selected));
    }

    this._pageContent.replaceChildren();
    for (
      let pageIndex: number = 0;
      pageIndex < this._pages.length;
      pageIndex++
    ) {
      const page: TabbedSearchablePromptPage = this._pages[pageIndex]!;
      if (this._selectedPage != "All" && this._selectedPage != page.name)
        continue;
      if (!itemMatches[pageIndex]!.some((matches) => matches)) continue;

      this._pageContent.appendChild(
        div(
          { class: "tabbedSearchablePromptPage" },
          h3(page.name),
          page.content,
        ),
      );
    }
  };

  public cleanUp = (): void => {
    this._search.removeEventListener("input", this._render);
    this._tabs.removeEventListener("click", this._whenTabClicked);
    this._cancelButton.removeEventListener("click", this._close);
  };
}
