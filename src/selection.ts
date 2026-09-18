// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  ChangeAddChannel,
  ChangeChannelBar,
  ChangeChannelOrder,
  ChangeDeleteBars,
  ChangeDuplicateSelectedReusedPatterns,
  ChangeEnsurePatternExists,
  ChangeEvents,
  ChangeInsertBars,
  ChangeNoteAdded,
  ChangeNoteLength,
  ChangeNoteTruncate,
  ChangePaste,
  ChangePatternNumbers,
  ChangePatternRhythm,
  ChangePatternSelection,
  ChangePatternsPerChannel,
  ChangeRemoveChannel,
  ChangeTrackSelection,
  ChangeTranspose,
  ChangeViewInstrument,
  comparePatternNotes,
} from "./changes.js";
import {
  type Channel,
  ChannelKind,
  Event,
  EventPoint,
  type Note,
  type Pattern,
} from "../synth/synth.js";
import { Config, type Dictionary } from "../synth/synth-config.js";
import { ChangeGroup } from "./change.js";
import type { SongDocument } from "./song-document.js";
import { trackChannelKindsAreCompatible } from "./channel-compatibility.js";

interface PatternCopy {
  notes?: Note[];
  automationEvents?: Event[][];
}

interface ChannelCopy {
  kind?: ChannelKind;
  isNoise?: boolean;
  patterns: Dictionary<PatternCopy>;
  bars: number[];
}

export function getCopiedChannelKind(channelCopy: ChannelCopy): ChannelKind {
  if (
    channelCopy.kind === ChannelKind.pitch ||
    channelCopy.kind === ChannelKind.noise ||
    channelCopy.kind === ChannelKind.automation
  ) {
    return channelCopy.kind;
  }
  return channelCopy.isNoise ? ChannelKind.noise : ChannelKind.pitch;
}

interface SelectionCopy {
  partDuration: number;
  channels: ChannelCopy[];
}

export class Selection {
  #doc: SongDocument;
  public boxSelectionX0 = 0;
  public boxSelectionY0 = 0;
  public boxSelectionX1 = 0;
  public boxSelectionY1 = 0;
  public digits = "";
  public instrumentDigits = "";
  public patternSelectionStart = 0;
  public patternSelectionEnd = 0;
  public patternSelectionActive = false;

  #changeTranspose: ChangeGroup | null = null;
  #changeReorder: ChangeGroup | null = null;
  #changeTrack: ChangeGroup | null = null;
  #changeInstrument: ChangeGroup | null = null;

  public constructor(_doc: SongDocument) {
    this.#doc = _doc;
  }

  public toJSON(): {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    start: number;
    end: number;
  } {
    return {
      x0: this.boxSelectionX0,
      x1: this.boxSelectionX1,
      y0: this.boxSelectionY0,
      y1: this.boxSelectionY1,
      start: this.patternSelectionStart,
      end: this.patternSelectionEnd,
    };
  }

  public fromJSON(json: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    start: number;
    end: number;
  }): void {
    if (json == null) {
      return;
    }
    this.boxSelectionX0 = Number(json["x0"]);
    this.boxSelectionX1 = Number(json["x1"]);
    this.boxSelectionY0 = Number(json["y0"]);
    this.boxSelectionY1 = Number(json["y1"]);
    this.patternSelectionStart = Number(json["start"]);
    this.patternSelectionEnd = Number(json["end"]);
    this.digits = "";
    this.instrumentDigits = "";
    this.patternSelectionActive = this.patternSelectionStart < this.patternSelectionEnd;
  }

  public selectionUpdated(): void {
    this.#doc.notifier.changed();
    this.digits = "";
    this.instrumentDigits = "";
  }

  public get boxSelectionBar(): number {
    return Math.min(this.boxSelectionX0, this.boxSelectionX1);
  }
  public get boxSelectionChannel(): number {
    return Math.min(this.boxSelectionY0, this.boxSelectionY1);
  }
  public get boxSelectionWidth(): number {
    return Math.abs(this.boxSelectionX0 - this.boxSelectionX1) + 1;
  }
  public get boxSelectionHeight(): number {
    return Math.abs(this.boxSelectionY0 - this.boxSelectionY1) + 1;
  }
  public get boxSelectionActive(): boolean {
    return this.boxSelectionWidth > 1 || this.boxSelectionHeight > 1;
  }
  public scrollToSelectedPattern(): void {
    this.#doc.barScrollPos = Math.min(
      this.#doc.bar,
      Math.max(this.#doc.bar - (this.#doc.trackVisibleBars - 1), this.#doc.barScrollPos),
    );
    this.#doc.channelScrollPos = Math.min(
      this.#doc.channel,
      Math.max(
        this.#doc.channel - (this.#doc.trackVisibleChannels - 1),
        this.#doc.channelScrollPos,
      ),
    );
  }
  public scrollToEndOfSelection(): void {
    this.#doc.barScrollPos = Math.min(
      this.boxSelectionX1,
      Math.max(this.boxSelectionX1 - (this.#doc.trackVisibleBars - 1), this.#doc.barScrollPos),
    );
    this.#doc.channelScrollPos = Math.min(
      this.boxSelectionY1,
      Math.max(
        this.boxSelectionY1 - (this.#doc.trackVisibleChannels - 1),
        this.#doc.channelScrollPos,
      ),
    );
  }

  public setChannelBar(channelIndex: number, bar: number): void {
    if (channelIndex === this.#doc.channel && bar === this.#doc.bar) {
      return;
    }
    const canReplaceLastChange: boolean = this.#doc.lastChangeWas(this.#changeTrack);
    this.#changeTrack = new ChangeGroup();
    this.#changeTrack.append(new ChangeChannelBar(this.#doc, channelIndex, bar));
    // Don't erase existing redo history just to look at highlighted pattern.
    if (this.#doc.hasRedoHistory()) {
      this.#doc.updateCurrentHistoryEntry();
    } else {
      this.#doc.record(this.#changeTrack, canReplaceLastChange);
    }
    this.selectionUpdated();
  }

  public setPattern(pattern: number): void {
    this.#doc.record(
      new ChangePatternNumbers(
        this.#doc,
        pattern,
        this.boxSelectionBar,
        this.boxSelectionChannel,
        this.boxSelectionWidth,
        this.boxSelectionHeight,
      ),
    );
  }

  public nextDigit(digit: string, forInstrument: boolean): void {
    const channel: Channel = this.#doc.song.channels[this.#doc.channel]!;

    if (forInstrument) {
      // Treat "0" as meaning instrument 10
      if (digit === "0") {
        digit = "10";
      }
      this.instrumentDigits += digit;
      let parsed = parseInt(this.instrumentDigits, 10);
      if (parsed !== 0 && parsed <= channel.instruments.length) {
        this.selectInstrument(parsed - 1);
        return;
      }
      this.instrumentDigits = digit;
      parsed = Number.parseInt(this.instrumentDigits, 10);
      if (parsed !== 0 && parsed <= channel.instruments.length) {
        this.selectInstrument(parsed - 1);
        return;
      }
      this.instrumentDigits = "";
    } else {
      if (this.digits.length > 0 && this.digits !== String(channel.bars[this.boxSelectionBar]!)) {
        this.digits = "";
      }

      this.digits += digit;
      let parsed: number = Number.parseInt(this.digits, 10);
      if (parsed <= this.#doc.song.patternsPerChannel) {
        this.setPattern(parsed);
        return;
      }

      this.digits = digit;
      parsed = Number.parseInt(this.digits, 10);
      if (parsed <= this.#doc.song.patternsPerChannel) {
        this.setPattern(parsed);
        return;
      }

      this.digits = "";
    }
  }

  public insertBars(): void {
    this.#doc.record(
      new ChangeInsertBars(
        this.#doc,
        this.boxSelectionBar + this.boxSelectionWidth,
        this.boxSelectionWidth,
      ),
    );
    const width: number = this.boxSelectionWidth;
    this.boxSelectionX0 += width;
    this.boxSelectionX1 += width;
    this.scrollToEndOfSelection();
  }

  public insertChannel(): void {
    const group: ChangeGroup = new ChangeGroup(),
      insertIndex: number = this.boxSelectionChannel + this.boxSelectionHeight,
      kind: ChannelKind = this.#doc.song.getChannelKind(insertIndex - 1);
    group.append(new ChangeAddChannel(this.#doc, insertIndex, kind));
    if (!group.isNoop()) {
      this.boxSelectionY0 = this.boxSelectionY1 = insertIndex;
      group.append(new ChangeChannelBar(this.#doc, insertIndex, this.#doc.bar));
      this.#doc.record(group);
    }
  }

  public deleteBars(): void {
    const group: ChangeGroup = new ChangeGroup();
    if (this.#doc.selection.patternSelectionActive) {
      if (this.boxSelectionActive) {
        group.append(
          new ChangeDuplicateSelectedReusedPatterns(
            this.#doc,
            this.boxSelectionBar,
            this.boxSelectionWidth,
            this.boxSelectionChannel,
            this.boxSelectionHeight,
          ),
        );
      }

      for (const channelIndex of this.#eachSelectedChannel()) {
        for (const pattern of this.#eachSelectedPattern(channelIndex)) {
          group.append(
            new ChangeNoteTruncate(
              this.#doc,
              pattern,
              this.#doc.selection.patternSelectionStart,
              this.#doc.selection.patternSelectionEnd,
            ),
          );
        }
      }
      group.append(new ChangePatternSelection(this.#doc, 0, 0));
    } else {
      group.append(new ChangeDeleteBars(this.#doc, this.boxSelectionBar, this.boxSelectionWidth));
      const width: number = this.boxSelectionWidth;
      this.boxSelectionX0 = Math.max(0, this.boxSelectionX0 - width);
      this.boxSelectionX1 = Math.max(0, this.boxSelectionX1 - width);
    }
    this.#doc.record(group);
  }

  public deleteChannel(): void {
    this.#doc.record(
      new ChangeRemoveChannel(
        this.#doc,
        this.boxSelectionChannel,
        this.boxSelectionChannel + this.boxSelectionHeight - 1,
      ),
    );
    this.boxSelectionY0 = this.boxSelectionY1 = this.#doc.channel;
  }

  *#eachSelectedChannel(): IterableIterator<number> {
    for (
      let channelIndex: number = this.boxSelectionChannel;
      channelIndex < this.boxSelectionChannel + this.boxSelectionHeight;
      channelIndex++
    ) {
      yield channelIndex;
    }
  }

  *#eachSelectedBar(): IterableIterator<number> {
    for (
      let bar: number = this.boxSelectionBar;
      bar < this.boxSelectionBar + this.boxSelectionWidth;
      bar++
    ) {
      yield bar;
    }
  }

  *#eachSelectedPattern(channelIndex: number): IterableIterator<Pattern> {
    const handledPatterns: Dictionary<boolean> = {};
    for (const bar of this.#eachSelectedBar()) {
      const currentPatternIndex: number = this.#doc.song.channels[channelIndex]!.bars[bar]!;
      if (currentPatternIndex === 0) {
        continue;
      }
      if (handledPatterns[String(currentPatternIndex)]!) {
        continue;
      }
      handledPatterns[String(currentPatternIndex)] = true;
      const pattern: Pattern | null = this.#doc.song.getPattern(channelIndex, bar);
      if (pattern == null) {
        throw new Error("Selected pattern is unavailable.");
      }
      yield pattern;
    }
  }

  #patternIndexIsUnused(channelIndex: number, patternIndex: number): boolean {
    for (let i = 0; i < this.#doc.song.barCount; i++) {
      if (this.#doc.song.channels[channelIndex]!.bars[i] === patternIndex) {
        return false;
      }
    }
    return true;
  }

  #copy(): void {
    const channels: ChannelCopy[] = [];

    for (const channelIndex of this.#eachSelectedChannel()) {
      const patterns: Dictionary<PatternCopy> = {},
        bars: number[] = [];

      for (const bar of this.#eachSelectedBar()) {
        const patternNumber: number = this.#doc.song.channels[channelIndex]!.bars[bar]!;
        bars.push(patternNumber);
        if (patterns[String(patternNumber)] === undefined) {
          const pattern: Pattern | null = this.#doc.song.getPattern(channelIndex, bar);
          let notes: Note[] = [],
            automationEvents: Event[][] | undefined;
          if (pattern != null) {
            if (this.#doc.song.getChannelIsAutomation(channelIndex)) {
              automationEvents = pattern.cloneAutomationEvents();
            } else if (this.patternSelectionActive) {
              for (const note of pattern.cloneNotes()) {
                if (note.end <= this.patternSelectionStart) {
                  continue;
                }
                if (note.start >= this.patternSelectionEnd) {
                  continue;
                }
                note.start -= this.patternSelectionStart;
                note.end -= this.patternSelectionStart;
                if (
                  note.start < 0 ||
                  note.end > this.patternSelectionEnd - this.patternSelectionStart
                ) {
                  new ChangeNoteLength(
                    null,
                    note,
                    Math.max(note.start, 0),
                    Math.min(this.patternSelectionEnd - this.patternSelectionStart, note.end),
                  );
                }
                notes.push(note);
              }
            } else {
              notes = pattern.notes;
            }
          }
          patterns[String(patternNumber)] =
            automationEvents === undefined ? { notes } : { automationEvents };
        }
      }

      const channelCopy: ChannelCopy = {
        kind: this.#doc.song.getChannelKind(channelIndex),
        isNoise: this.#doc.song.getChannelIsNoise(channelIndex),
        patterns,
        bars,
      };
      channels.push(channelCopy);
    }

    const selectionCopy: SelectionCopy = {
      partDuration: this.patternSelectionActive
        ? this.patternSelectionEnd - this.patternSelectionStart
        : this.#doc.song.beatsPerBar * Config.partsPerBeat,
      channels,
    };
    window.localStorage.setItem("selectionCopy", JSON.stringify(selectionCopy));
  }

  #clearSelection(): void {
    new ChangePatternSelection(this.#doc, 0, 0);
    this.resetBoxSelection();
  }

  public copy(): void {
    this.#copy();
    this.#clearSelection();
  }

  public cut(): void {
    this.#copy();

    const group: ChangeGroup = new ChangeGroup();
    if (this.patternSelectionActive) {
      if (this.boxSelectionActive) {
        group.append(
          new ChangeDuplicateSelectedReusedPatterns(
            this.#doc,
            this.boxSelectionBar,
            this.boxSelectionWidth,
            this.boxSelectionChannel,
            this.boxSelectionHeight,
          ),
        );
      }

      for (const channelIndex of this.#eachSelectedChannel()) {
        for (const pattern of this.#eachSelectedPattern(channelIndex)) {
          group.append(
            new ChangeNoteTruncate(
              this.#doc,
              pattern,
              this.patternSelectionStart,
              this.patternSelectionEnd,
            ),
          );
        }
      }
    } else {
      group.append(
        new ChangePatternNumbers(
          this.#doc,
          0,
          this.boxSelectionBar,
          this.boxSelectionChannel,
          this.boxSelectionWidth,
          this.boxSelectionHeight,
        ),
      );
    }

    this.#doc.record(group);
    this.#clearSelection();
  }

  // I'm sorry this function is so complicated!
  // Basically I'm trying to avoid accidentally modifying patterns that are used
  // Elsewhere in the song (unless we're just pasting a single pattern) but I'm
  // Also trying to reuse patterns where it makes sense to do so, especially
  // In the same channel it was copied from.
  public pasteNotes(): void {
    const selectionCopy: SelectionCopy | null = JSON.parse(
      String(window.localStorage.getItem("selectionCopy")),
    );
    if (selectionCopy == null) {
      this.#clearSelection();
      return;
    }
    const channelCopies: ChannelCopy[] = selectionCopy["channels"] || [],
      copiedPartDuration: number = selectionCopy["partDuration"] >>> 0,
      group: ChangeGroup = new ChangeGroup(),
      fillSelection: boolean = this.boxSelectionActive,
      pasteHeight: number = fillSelection
        ? this.boxSelectionHeight
        : Math.min(
            channelCopies.length,
            this.#doc.song.getChannelCount() - this.boxSelectionChannel,
          );
    for (let pasteChannel = 0; pasteChannel < pasteHeight; pasteChannel++) {
      const channelCopy: ChannelCopy = channelCopies[pasteChannel % channelCopies.length]!,
        channelIndex: number = this.boxSelectionChannel + pasteChannel,
        copiedKind: ChannelKind = getCopiedChannelKind(channelCopy),
        patternCopies: Dictionary<PatternCopy> = channelCopy["patterns"] || {},
        copiedBars: number[] = channelCopy["bars"] || [];
      if (copiedBars.length === 0) {
        continue;
      }
      if (
        !trackChannelKindsAreCompatible(copiedKind, this.#doc.song.getChannelKind(channelIndex))
      ) {
        continue;
      }

      const pasteWidth: number = fillSelection
        ? this.boxSelectionWidth
        : Math.min(copiedBars.length, this.#doc.song.barCount - this.boxSelectionBar);
      if (copiedKind === ChannelKind.automation) {
        this.#pasteAutomationChannel(group, channelIndex, patternCopies, copiedBars, pasteWidth);
        continue;
      }
      if (!fillSelection && copiedBars.length === 1 && channelCopies.length === 1) {
        // Special case: if there's just one pattern being copied, try to insert it
        // Into whatever pattern is already selected.
        const copiedPatternIndex: number = copiedBars[0]! >>> 0,
          bar: number = this.boxSelectionBar,
          currentPatternIndex: number = this.#doc.song.channels[channelIndex]!.bars[bar]!;
        if (copiedPatternIndex === 0 && currentPatternIndex === 0) {
          continue;
        }

        const patternCopy: PatternCopy = patternCopies[String(copiedPatternIndex)]!;
        if (currentPatternIndex === 0) {
          const existingPattern: Pattern | undefined =
            this.#doc.song.channels[channelIndex]!.patterns[copiedPatternIndex - 1]!;
          if (
            existingPattern !== undefined &&
            !this.patternSelectionActive &&
            (comparePatternNotes(patternCopy.notes ?? [], existingPattern.notes) ||
              this.#patternIndexIsUnused(channelIndex, copiedPatternIndex))
          ) {
            group.append(
              new ChangePatternNumbers(this.#doc, copiedPatternIndex, bar, channelIndex, 1, 1),
            );
          } else {
            group.append(new ChangeEnsurePatternExists(this.#doc, channelIndex, bar));
          }
        }

        const pattern: Pattern | null = this.#doc.song.getPattern(channelIndex, bar);
        if (pattern == null) {
          throw new Error("Selected pattern is unavailable.");
        }
        group.append(
          new ChangePaste(
            this.#doc,
            pattern,
            patternCopy.notes ?? [],
            this.patternSelectionActive ? this.patternSelectionStart : 0,
            this.patternSelectionActive
              ? this.patternSelectionEnd
              : Config.partsPerBeat * this.#doc.song.beatsPerBar,
            copiedPartDuration,
          ),
        );
      } else if (this.patternSelectionActive) {
        const reusablePatterns: Dictionary<number> = {},
          usedPatterns: Dictionary<boolean> = {};

        group.append(
          new ChangeDuplicateSelectedReusedPatterns(
            this.#doc,
            this.boxSelectionBar,
            pasteWidth,
            this.boxSelectionChannel,
            pasteHeight,
          ),
        );

        for (let pasteBar = 0; pasteBar < pasteWidth; pasteBar++) {
          const bar: number = this.boxSelectionBar + pasteBar,
            copiedPatternIndex: number = copiedBars[pasteBar % copiedBars.length]! >>> 0,
            currentPatternIndex: number = this.#doc.song.channels[channelIndex]!.bars[bar]!,
            reusedIndex: string = [copiedPatternIndex, currentPatternIndex].join(",");
          if (copiedPatternIndex === 0 && currentPatternIndex === 0) {
            continue;
          }
          if (reusablePatterns[reusedIndex]! !== undefined) {
            group.append(
              new ChangePatternNumbers(
                this.#doc,
                reusablePatterns[reusedIndex],
                bar,
                channelIndex,
                1,
                1,
              ),
            );
            continue;
          }

          if (currentPatternIndex === 0) {
            group.append(new ChangeEnsurePatternExists(this.#doc, channelIndex, bar));
          } else {
            const pattern: Pattern | null = this.#doc.song.getPattern(channelIndex, bar);
            if (pattern == null) {
              throw new Error("Selected pattern is unavailable.");
            }

            if (usedPatterns[String(currentPatternIndex)]!) {
              // If this pattern is used here and elsewhere, it's not safe to modify it directly, so
              // make a duplicate of it and modify that instead.
              group.append(new ChangePatternNumbers(this.#doc, 0, bar, channelIndex, 1, 1));
              group.append(new ChangeEnsurePatternExists(this.#doc, channelIndex, bar));
              const newPattern: Pattern | null = this.#doc.song.getPattern(channelIndex, bar);
              if (newPattern == null) {
                throw new Error("Pattern was not created.");
              }
              for (const note of pattern.cloneNotes()) {
                group.append(
                  new ChangeNoteAdded(this.#doc, newPattern, note, newPattern.notes.length, false),
                );
              }
            } else {
              usedPatterns[String(currentPatternIndex)] = true;
            }
          }

          const pattern: Pattern | null = this.#doc.song.getPattern(channelIndex, bar);
          if (pattern == null) {
            throw new Error("Selected pattern is unavailable.");
          }
          if (copiedPatternIndex === 0) {
            group.append(
              new ChangeNoteTruncate(
                this.#doc,
                pattern,
                this.patternSelectionStart,
                this.patternSelectionEnd,
              ),
            );
          } else {
            const patternCopy: PatternCopy = patternCopies[String(copiedPatternIndex)]!;
            group.append(
              new ChangePaste(
                this.#doc,
                pattern,
                patternCopy.notes ?? [],
                this.patternSelectionStart,
                this.patternSelectionEnd,
                copiedPartDuration,
              ),
            );
          }

          reusablePatterns[reusedIndex] = this.#doc.song.channels[channelIndex]!.bars[bar]!;
        }
      } else {
        for (let pasteBar = 0; pasteBar < pasteWidth; pasteBar++) {
          // When a pattern becomes unused when replaced by rectangular selection pasting,
          // Remove all the notes from the pattern so that it may be reused.
          this.erasePatternInBar(group, channelIndex, this.boxSelectionBar + pasteBar);
        }

        const reusablePatterns: Dictionary<number> = {};
        for (let pasteBar = 0; pasteBar < pasteWidth; pasteBar++) {
          const bar: number = this.boxSelectionBar + pasteBar,
            copiedPatternIndex: number = copiedBars[pasteBar % copiedBars.length]! >>> 0,
            reusedIndex = String(copiedPatternIndex);

          if (copiedPatternIndex === 0) {
            continue;
          }
          if (reusablePatterns[reusedIndex]! !== undefined) {
            group.append(
              new ChangePatternNumbers(
                this.#doc,
                reusablePatterns[reusedIndex],
                bar,
                channelIndex,
                1,
                1,
              ),
            );
            continue;
          }

          const patternCopy: PatternCopy = patternCopies[String(copiedPatternIndex)]!,
            existingPattern: Pattern | undefined =
              this.#doc.song.channels[channelIndex]!.patterns[copiedPatternIndex - 1]!;

          if (
            existingPattern !== undefined &&
            copiedPartDuration === Config.partsPerBeat * this.#doc.song.beatsPerBar &&
            comparePatternNotes(patternCopy.notes ?? [], existingPattern.notes)
          ) {
            group.append(
              new ChangePatternNumbers(this.#doc, copiedPatternIndex, bar, channelIndex, 1, 1),
            );
          } else {
            if (
              existingPattern !== undefined &&
              this.#patternIndexIsUnused(channelIndex, copiedPatternIndex)
            ) {
              group.append(
                new ChangePatternNumbers(this.#doc, copiedPatternIndex, bar, channelIndex, 1, 1),
              );
            } else {
              group.append(new ChangeEnsurePatternExists(this.#doc, channelIndex, bar));
            }
            const pattern: Pattern | null = this.#doc.song.getPattern(channelIndex, bar);
            if (pattern == null) {
              throw new Error("Selected pattern is unavailable.");
            }
            group.append(
              new ChangePaste(
                this.#doc,
                pattern,
                patternCopy.notes ?? [],
                this.patternSelectionActive ? this.patternSelectionStart : 0,
                this.patternSelectionActive
                  ? this.patternSelectionEnd
                  : Config.partsPerBeat * this.#doc.song.beatsPerBar,
                copiedPartDuration,
              ),
            );
          }

          reusablePatterns[reusedIndex] = this.#doc.song.channels[channelIndex]!.bars[bar]!;
        }
      }
    }

    this.#doc.record(group);
    this.#clearSelection();
  }

  #decodeAutomationPattern(
    patternCopy: PatternCopy | undefined,
    rowCount: number,
  ): Event[][] | null {
    const copiedRows: unknown = patternCopy?.automationEvents;
    if (!Array.isArray(copiedRows)) {
      return null;
    }
    const rows: Event[][] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const copiedEvents: unknown = copiedRows[rowIndex] ?? [];
      if (!Array.isArray(copiedEvents) || copiedEvents.length > Config.automationEventsPerRowMax) {
        return null;
      }
      const events: Event[] = [];
      for (const copiedEvent of copiedEvents) {
        if (
          copiedEvent == null ||
          typeof copiedEvent !== "object" ||
          typeof copiedEvent.start !== "number" ||
          !Number.isFinite(copiedEvent.start) ||
          typeof copiedEvent.end !== "number" ||
          !Number.isFinite(copiedEvent.end) ||
          !Array.isArray(copiedEvent.points) ||
          copiedEvent.points.length === 0 ||
          copiedEvent.points.length > Config.automationPointsPerEventMax
        ) {
          return null;
        }
        const points: EventPoint[] = [];
        for (const copiedPoint of copiedEvent.points) {
          if (
            copiedPoint == null ||
            typeof copiedPoint !== "object" ||
            typeof copiedPoint.time !== "number" ||
            !Number.isFinite(copiedPoint.time) ||
            typeof copiedPoint.value !== "number" ||
            !Number.isFinite(copiedPoint.value)
          ) {
            return null;
          }
          points.push(new EventPoint(copiedPoint.time, copiedPoint.value));
        }
        events.push(new Event(copiedEvent.start, copiedEvent.end, points));
      }
      rows.push(events);
    }
    return rows;
  }

  #pasteAutomationChannel(
    group: ChangeGroup,
    channelIndex: number,
    patternCopies: Dictionary<PatternCopy>,
    copiedBars: readonly number[],
    pasteWidth: number,
  ): void {
    const reusablePatterns: Dictionary<number> = {};
    for (let pasteBar = 0; pasteBar < pasteWidth; pasteBar++) {
      this.erasePatternInBar(group, channelIndex, this.boxSelectionBar + pasteBar);
    }
    for (let pasteBar = 0; pasteBar < pasteWidth; pasteBar++) {
      const bar: number = this.boxSelectionBar + pasteBar,
        copiedPatternIndex: number = copiedBars[pasteBar % copiedBars.length]! >>> 0;
      if (copiedPatternIndex === 0) {
        continue;
      }
      const key = String(copiedPatternIndex);
      if (reusablePatterns[key]! !== undefined) {
        group.append(
          new ChangePatternNumbers(this.#doc, reusablePatterns[key], bar, channelIndex, 1, 1),
        );
        continue;
      }
      group.append(new ChangeEnsurePatternExists(this.#doc, channelIndex, bar));
      const pattern: Pattern | null = this.#doc.song.getPattern(channelIndex, bar);
      if (pattern == null) {
        throw new Error("Selected pattern is unavailable.");
      }
      const rowCount: number = this.#doc.song.channels[channelIndex]!.automationRows.length,
        copiedPattern: Event[][] | null = this.#decodeAutomationPattern(
          patternCopies[key]!,
          rowCount,
        );
      if (copiedPattern == null) {
        continue;
      }
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        group.append(
          new ChangeEvents(
            this.#doc,
            pattern.automationEvents[rowIndex]!,
            copiedPattern[rowIndex]!,
          ),
        );
      }
      reusablePatterns[key] = this.#doc.song.channels[channelIndex]!.bars[bar]!;
    }
  }

  // Set a bar's pattern number to zero, and if that pattern was not used
  // Elsewhere in the channel, erase all notes in it as well.
  public erasePatternInBar(group: ChangeGroup, channelIndex: number, bar: number): void {
    const removedPattern: number = this.#doc.song.channels[channelIndex]!.bars[bar]!;
    if (removedPattern !== 0) {
      group.append(new ChangePatternNumbers(this.#doc, 0, bar, channelIndex, 1, 1));
      if (this.#patternIndexIsUnused(channelIndex, removedPattern)) {
        // When a pattern becomes unused when replaced by rectangular selection pasting,
        // Remove all the notes from the pattern so that it may be reused.
        const pattern: Pattern =
          this.#doc.song.channels[channelIndex]!.patterns[removedPattern - 1]!;
        pattern.reset();
        if (this.#doc.song.getChannelIsAutomation(channelIndex)) {
          pattern.ensureAutomationRowCount(
            this.#doc.song.channels[channelIndex]!.automationRows.length,
          );
        }
      }
    }
  }

  public pasteNumbers(): void {
    const selectionCopy: SelectionCopy | null = JSON.parse(
      String(window.localStorage.getItem("selectionCopy")),
    );
    if (selectionCopy == null) {
      this.#clearSelection();
      return;
    }
    const channelCopies: ChannelCopy[] = selectionCopy["channels"] || [],
      group: ChangeGroup = new ChangeGroup(),
      fillSelection: boolean = this.boxSelectionActive,
      pasteHeight: number = fillSelection
        ? this.boxSelectionHeight
        : Math.min(
            channelCopies.length,
            this.#doc.song.getChannelCount() - this.boxSelectionChannel,
          );
    for (let pasteChannel = 0; pasteChannel < pasteHeight; pasteChannel++) {
      const channelCopy: ChannelCopy = channelCopies[pasteChannel % channelCopies.length]!,
        channelIndex: number = this.boxSelectionChannel + pasteChannel;

      if (
        !trackChannelKindsAreCompatible(
          getCopiedChannelKind(channelCopy),
          this.#doc.song.getChannelKind(channelIndex),
        )
      ) {
        continue;
      }

      const copiedBars: number[] = channelCopy["bars"] || [];
      if (copiedBars.length === 0) {
        continue;
      }

      const pasteWidth: number = fillSelection
        ? this.boxSelectionWidth
        : Math.min(copiedBars.length, this.#doc.song.barCount - this.boxSelectionBar);
      for (let pasteBar = 0; pasteBar < pasteWidth; pasteBar++) {
        const copiedPatternIndex: number = copiedBars[pasteBar % copiedBars.length]! >>> 0,
          bar: number = this.boxSelectionBar + pasteBar;

        if (copiedPatternIndex > this.#doc.song.patternsPerChannel) {
          group.append(new ChangePatternsPerChannel(this.#doc, copiedPatternIndex));
        }

        group.append(
          new ChangePatternNumbers(this.#doc, copiedPatternIndex, bar, channelIndex, 1, 1),
        );
      }
    }

    this.#doc.record(group);
    this.#clearSelection();
  }

  public selectAll(): void {
    new ChangePatternSelection(this.#doc, 0, 0);
    if (
      this.boxSelectionBar === 0 &&
      this.boxSelectionChannel === 0 &&
      this.boxSelectionWidth === this.#doc.song.barCount &&
      this.boxSelectionHeight === this.#doc.song.getChannelCount()
    ) {
      this.setTrackSelection(this.#doc.bar, this.#doc.bar, this.#doc.channel, this.#doc.channel);
    } else {
      this.setTrackSelection(
        0,
        this.#doc.song.barCount - 1,
        0,
        this.#doc.song.getChannelCount() - 1,
      );
    }
    this.selectionUpdated();
  }

  public selectChannel(): void {
    new ChangePatternSelection(this.#doc, 0, 0);
    if (this.boxSelectionBar === 0 && this.boxSelectionWidth === this.#doc.song.barCount) {
      this.setTrackSelection(
        this.#doc.bar,
        this.#doc.bar,
        this.boxSelectionY0,
        this.boxSelectionY1,
      );
    } else {
      this.setTrackSelection(
        0,
        this.#doc.song.barCount - 1,
        this.boxSelectionY0,
        this.boxSelectionY1,
      );
    }
    this.selectionUpdated();
  }

  public duplicatePatterns(): void {
    this.#doc.record(
      new ChangeDuplicateSelectedReusedPatterns(
        this.#doc,
        this.boxSelectionBar,
        this.boxSelectionWidth,
        this.boxSelectionChannel,
        this.boxSelectionHeight,
      ),
    );
  }

  public muteChannels(allChannels: boolean): void {
    if (allChannels) {
      let anyMuted = false;
      for (let channelIndex = 0; channelIndex < this.#doc.song.channels.length; channelIndex++) {
        if (this.#doc.song.channels[channelIndex]!.muted) {
          anyMuted = true;
          break;
        }
      }
      for (let channelIndex = 0; channelIndex < this.#doc.song.channels.length; channelIndex++) {
        this.#doc.song.channels[channelIndex]!.muted = !anyMuted;
      }
    } else {
      let anyUnmuted = false;
      for (const channelIndex of this.#eachSelectedChannel()) {
        if (!this.#doc.song.channels[channelIndex]!.muted) {
          anyUnmuted = true;
          break;
        }
      }
      for (const channelIndex of this.#eachSelectedChannel()) {
        this.#doc.song.channels[channelIndex]!.muted = anyUnmuted;
      }
    }

    this.#doc.notifier.changed();
  }

  public soloChannels(invert: boolean): void {
    let alreadySoloed = true;

    for (let channelIndex = 0; channelIndex < this.#doc.song.channels.length; channelIndex++) {
      const shouldBeMuted: boolean =
        channelIndex < this.boxSelectionChannel ||
        channelIndex >= this.boxSelectionChannel + this.boxSelectionHeight
          ? !invert
          : invert;
      if (this.#doc.song.channels[channelIndex]!.muted !== shouldBeMuted) {
        alreadySoloed = false;
        break;
      }
    }

    if (alreadySoloed) {
      for (let channelIndex = 0; channelIndex < this.#doc.song.channels.length; channelIndex++) {
        this.#doc.song.channels[channelIndex]!.muted = false;
      }
    } else {
      for (let channelIndex = 0; channelIndex < this.#doc.song.channels.length; channelIndex++) {
        this.#doc.song.channels[channelIndex]!.muted =
          channelIndex < this.boxSelectionChannel ||
          channelIndex >= this.boxSelectionChannel + this.boxSelectionHeight
            ? !invert
            : invert;
      }
    }

    this.#doc.notifier.changed();
  }

  public forceRhythm(): void {
    const group: ChangeGroup = new ChangeGroup();

    if (this.boxSelectionActive) {
      group.append(
        new ChangeDuplicateSelectedReusedPatterns(
          this.#doc,
          this.boxSelectionBar,
          this.boxSelectionWidth,
          this.boxSelectionChannel,
          this.boxSelectionHeight,
        ),
      );
    }

    for (const channelIndex of this.#eachSelectedChannel()) {
      for (const pattern of this.#eachSelectedPattern(channelIndex)) {
        group.append(new ChangePatternRhythm(this.#doc, pattern));
      }
    }

    this.#doc.record(group);
  }

  public setTrackSelection(newX0: number, newX1: number, newY0: number, newY1: number): void {
    const canReplaceLastChange: boolean = this.#doc.lastChangeWas(this.#changeTrack);
    this.#changeTrack = new ChangeGroup();
    this.#changeTrack.append(new ChangeTrackSelection(this.#doc, newX0, newX1, newY0, newY1));
    // Don't erase existing redo history just to change track selection.
    if (this.#doc.hasRedoHistory()) {
      this.#doc.updateCurrentHistoryEntry();
    } else {
      this.#doc.record(this.#changeTrack, canReplaceLastChange);
    }
  }

  public transpose(upward: boolean, octave: boolean): void {
    const canReplaceLastChange: boolean = this.#doc.lastChangeWas(this.#changeTranspose);
    this.#changeTranspose = new ChangeGroup();

    if (this.boxSelectionActive) {
      this.#changeTranspose.append(
        new ChangeDuplicateSelectedReusedPatterns(
          this.#doc,
          this.boxSelectionBar,
          this.boxSelectionWidth,
          this.boxSelectionChannel,
          this.boxSelectionHeight,
        ),
      );
    }

    for (const channelIndex of this.#eachSelectedChannel()) {
      for (const pattern of this.#eachSelectedPattern(channelIndex)) {
        this.#changeTranspose.append(
          new ChangeTranspose(
            this.#doc,
            channelIndex,
            pattern,
            upward,
            this.#doc.prefs.notesOutsideScale,
            octave,
          ),
        );
      }
    }

    this.#doc.record(this.#changeTranspose, canReplaceLastChange);
  }

  public swapChannels(offset: number): void {
    const possibleSectionBoundaries: number[] = [
      this.#doc.song.pitchChannelCount,
      this.#doc.song.pitchChannelCount + this.#doc.song.noiseChannelCount,
      this.#doc.song.getChannelCount(),
    ];
    let channelSectionMin = 0,
      channelSectionMax = 0;
    for (const nextBoundary of possibleSectionBoundaries) {
      if (
        (this.boxSelectionChannel < nextBoundary && offset < 0) ||
        this.boxSelectionChannel + this.boxSelectionHeight <= nextBoundary
      ) {
        channelSectionMax = nextBoundary - 1;
        break;
      }
      channelSectionMin = nextBoundary;
    }
    const newSelectionMin: number = Math.max(this.boxSelectionChannel, channelSectionMin),
      newSelectionMax: number = Math.min(
        this.boxSelectionChannel + this.boxSelectionHeight - 1,
        channelSectionMax,
      );
    offset = Math.max(offset, channelSectionMin - newSelectionMin);
    offset = Math.min(offset, channelSectionMax - newSelectionMax);

    if (offset !== 0) {
      const canReplaceLastChange: boolean = this.#doc.lastChangeWas(this.#changeReorder);
      this.#changeReorder = new ChangeGroup();
      this.boxSelectionY0 = newSelectionMin + offset;
      this.boxSelectionY1 = newSelectionMax + offset;
      this.#changeReorder.append(
        new ChangeChannelOrder(this.#doc, newSelectionMin, newSelectionMax, offset),
      );
      this.#changeReorder.append(
        new ChangeChannelBar(
          this.#doc,
          Math.max(this.boxSelectionY0, Math.min(this.boxSelectionY1, this.#doc.channel + offset)),
          this.#doc.bar,
        ),
      );
      this.selectionUpdated();
      this.#doc.record(this.#changeReorder, canReplaceLastChange);
    }
  }

  public selectInstrument(instrument: number): void {
    if (this.#doc.viewedInstrument[this.#doc.channel]! !== instrument) {
      const canReplaceLastChange: boolean = this.#doc.lastChangeWas(this.#changeInstrument);
      this.#changeInstrument = new ChangeGroup();
      this.#changeInstrument.append(new ChangeViewInstrument(this.#doc, instrument));
      if (this.#doc.hasRedoHistory()) {
        this.#doc.updateCurrentHistoryEntry();
      } else {
        // Don't erase existing redo history just to look at highlighted pattern.
        this.#doc.record(this.#changeInstrument, canReplaceLastChange);
      }
    }
  }

  public resetBoxSelection(): void {
    this.boxSelectionX0 = this.boxSelectionX1 = this.#doc.bar;
    this.boxSelectionY0 = this.boxSelectionY1 = this.#doc.channel;
  }
}
