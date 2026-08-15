// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { type Dictionary, Config } from "../synth/SynthConfig.js";
import { Note, Pattern, Channel } from "../synth/synth.js";
import { SongDocument } from "./SongDocument.js";
import { ChangeGroup } from "./Change.js";
import {
  ChangeTrackSelection,
  ChangeChannelBar,
  ChangeDuplicateSelectedReusedPatterns,
  ChangeNoteAdded,
  ChangeNoteTruncate,
  ChangePatternNumbers,
  ChangePatternSelection,
  ChangeInsertBars,
  ChangeAddChannel,
  ChangeDeleteBars,
  ChangeRemoveChannel,
  ChangeEnsurePatternExists,
  ChangeNoteLength,
  ChangePaste,
  ChangeViewInstrument,
  ChangePatternsPerChannel,
  ChangePatternRhythm,
  ChangeTranspose,
  ChangeChannelOrder,
  comparePatternNotes,
} from "./changes.js";

interface PatternCopy {
  notes: any[];
}

interface ChannelCopy {
  isNoise: boolean;
  patterns: Dictionary<PatternCopy>;
  bars: number[];
}

interface SelectionCopy {
  partDuration: number;
  channels: ChannelCopy[];
}

export class Selection {
  public boxSelectionX0: number = 0;
  public boxSelectionY0: number = 0;
  public boxSelectionX1: number = 0;
  public boxSelectionY1: number = 0;
  public digits: string = "";
  public instrumentDigits: string = "";
  public patternSelectionStart: number = 0;
  public patternSelectionEnd: number = 0;
  public patternSelectionActive: boolean = false;

  private _changeTranspose: ChangeGroup | null = null;
  private _changeReorder: ChangeGroup | null = null;
  private _changeTrack: ChangeGroup | null = null;
  private _changeInstrument: ChangeGroup | null = null;

  constructor(private _doc: SongDocument) {}

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
    if (json == null) return;
    this.boxSelectionX0 = +json["x0"];
    this.boxSelectionX1 = +json["x1"];
    this.boxSelectionY0 = +json["y0"];
    this.boxSelectionY1 = +json["y1"];
    this.patternSelectionStart = +json["start"];
    this.patternSelectionEnd = +json["end"];
    this.digits = "";
    this.instrumentDigits = "";
    this.patternSelectionActive =
      this.patternSelectionStart < this.patternSelectionEnd;
  }

  public selectionUpdated(): void {
    this._doc.notifier.changed();
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
    this._doc.barScrollPos = Math.min(
      this._doc.bar,
      Math.max(
        this._doc.bar - (this._doc.trackVisibleBars - 1),
        this._doc.barScrollPos,
      ),
    );
    this._doc.channelScrollPos = Math.min(
      this._doc.channel,
      Math.max(
        this._doc.channel - (this._doc.trackVisibleChannels - 1),
        this._doc.channelScrollPos,
      ),
    );
  }
  public scrollToEndOfSelection(): void {
    this._doc.barScrollPos = Math.min(
      this.boxSelectionX1,
      Math.max(
        this.boxSelectionX1 - (this._doc.trackVisibleBars - 1),
        this._doc.barScrollPos,
      ),
    );
    this._doc.channelScrollPos = Math.min(
      this.boxSelectionY1,
      Math.max(
        this.boxSelectionY1 - (this._doc.trackVisibleChannels - 1),
        this._doc.channelScrollPos,
      ),
    );
  }

  public setChannelBar(channelIndex: number, bar: number): void {
    if (channelIndex == this._doc.channel && bar == this._doc.bar) return;
    const canReplaceLastChange: boolean = this._doc.lastChangeWas(
      this._changeTrack,
    );
    this._changeTrack = new ChangeGroup();
    this._changeTrack.append(
      new ChangeChannelBar(this._doc, channelIndex, bar),
    );
    // Don't erase existing redo history just to look at highlighted pattern.
    if (!this._doc.hasRedoHistory()) {
      this._doc.record(this._changeTrack, canReplaceLastChange);
    } else {
      this._doc.updateCurrentHistoryEntry();
    }
    this.selectionUpdated();
  }

  public setPattern(pattern: number): void {
    this._doc.record(
      new ChangePatternNumbers(
        this._doc,
        pattern,
        this.boxSelectionBar,
        this.boxSelectionChannel,
        this.boxSelectionWidth,
        this.boxSelectionHeight,
      ),
    );
  }

  public nextDigit(digit: string, forInstrument: boolean): void {
    const channel: Channel = this._doc.song.channels[this._doc.channel];

    if (forInstrument) {
      // Treat "0" as meaning instrument 10
      if (digit == "0") digit = "10";
      this.instrumentDigits += digit;
      var parsed = parseInt(this.instrumentDigits);
      if (parsed != 0 && parsed <= channel.instruments.length) {
        this.selectInstrument(parsed - 1);
        return;
      }
      this.instrumentDigits = digit;
      parsed = parseInt(this.instrumentDigits);
      if (parsed != 0 && parsed <= channel.instruments.length) {
        this.selectInstrument(parsed - 1);
        return;
      }
      this.instrumentDigits = "";
    } else {
      if (
        this.digits.length > 0 &&
        this.digits != String(channel.bars[this.boxSelectionBar])
      ) {
        this.digits = "";
      }

      this.digits += digit;
      let parsed: number = parseInt(this.digits);
      if (parsed <= this._doc.song.patternsPerChannel) {
        this.setPattern(parsed);
        return;
      }

      this.digits = digit;
      parsed = parseInt(this.digits);
      if (parsed <= this._doc.song.patternsPerChannel) {
        this.setPattern(parsed);
        return;
      }

      this.digits = "";
    }
  }

  public insertBars(): void {
    this._doc.record(
      new ChangeInsertBars(
        this._doc,
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
    const group: ChangeGroup = new ChangeGroup();
    const insertIndex: number =
      this.boxSelectionChannel + this.boxSelectionHeight;
    const isNoise: boolean = this._doc.song.getChannelIsNoise(insertIndex - 1);
    group.append(new ChangeAddChannel(this._doc, insertIndex, isNoise));
    if (!group.isNoop()) {
      this.boxSelectionY0 = this.boxSelectionY1 = insertIndex;
      group.append(new ChangeChannelBar(this._doc, insertIndex, this._doc.bar));
      this._doc.record(group);
    }
  }

  public deleteBars(): void {
    const group: ChangeGroup = new ChangeGroup();
    if (this._doc.selection.patternSelectionActive) {
      if (this.boxSelectionActive) {
        group.append(
          new ChangeDuplicateSelectedReusedPatterns(
            this._doc,
            this.boxSelectionBar,
            this.boxSelectionWidth,
            this.boxSelectionChannel,
            this.boxSelectionHeight,
          ),
        );
      }

      for (const channelIndex of this._eachSelectedChannel()) {
        for (const pattern of this._eachSelectedPattern(channelIndex)) {
          group.append(
            new ChangeNoteTruncate(
              this._doc,
              pattern,
              this._doc.selection.patternSelectionStart,
              this._doc.selection.patternSelectionEnd,
            ),
          );
        }
      }
      group.append(new ChangePatternSelection(this._doc, 0, 0));
    } else {
      group.append(
        new ChangeDeleteBars(
          this._doc,
          this.boxSelectionBar,
          this.boxSelectionWidth,
        ),
      );
      const width: number = this.boxSelectionWidth;
      this.boxSelectionX0 = Math.max(0, this.boxSelectionX0 - width);
      this.boxSelectionX1 = Math.max(0, this.boxSelectionX1 - width);
    }
    this._doc.record(group);
  }

  public deleteChannel(): void {
    this._doc.record(
      new ChangeRemoveChannel(
        this._doc,
        this.boxSelectionChannel,
        this.boxSelectionChannel + this.boxSelectionHeight - 1,
      ),
    );
    this.boxSelectionY0 = this.boxSelectionY1 = this._doc.channel;
  }

  private *_eachSelectedChannel(): IterableIterator<number> {
    for (
      let channelIndex: number = this.boxSelectionChannel;
      channelIndex < this.boxSelectionChannel + this.boxSelectionHeight;
      channelIndex++
    ) {
      yield channelIndex;
    }
  }

  private *_eachSelectedBar(): IterableIterator<number> {
    for (
      let bar: number = this.boxSelectionBar;
      bar < this.boxSelectionBar + this.boxSelectionWidth;
      bar++
    ) {
      yield bar;
    }
  }

  private *_eachSelectedPattern(
    channelIndex: number,
  ): IterableIterator<Pattern> {
    const handledPatterns: Dictionary<boolean> = {};
    for (const bar of this._eachSelectedBar()) {
      const currentPatternIndex: number =
        this._doc.song.channels[channelIndex].bars[bar];
      if (currentPatternIndex == 0) continue;
      if (handledPatterns[String(currentPatternIndex)]) continue;
      handledPatterns[String(currentPatternIndex)] = true;
      const pattern: Pattern | null = this._doc.song.getPattern(
        channelIndex,
        bar,
      );
      if (pattern == null) throw new Error();
      yield pattern;
    }
  }

  private _patternIndexIsUnused(
    channelIndex: number,
    patternIndex: number,
  ): boolean {
    for (let i: number = 0; i < this._doc.song.barCount; i++) {
      if (this._doc.song.channels[channelIndex].bars[i] == patternIndex) {
        return false;
      }
    }
    return true;
  }

  private _copy(): void {
    const channels: ChannelCopy[] = [];

    for (const channelIndex of this._eachSelectedChannel()) {
      const patterns: Dictionary<PatternCopy> = {};
      const bars: number[] = [];

      for (const bar of this._eachSelectedBar()) {
        const patternNumber: number =
          this._doc.song.channels[channelIndex].bars[bar];
        bars.push(patternNumber);
        if (patterns[String(patternNumber)] == undefined) {
          const pattern: Pattern | null = this._doc.song.getPattern(
            channelIndex,
            bar,
          );
          let notes: Note[] = [];
          if (pattern != null) {
            if (this.patternSelectionActive) {
              for (const note of pattern.cloneNotes()) {
                if (note.end <= this.patternSelectionStart) continue;
                if (note.start >= this.patternSelectionEnd) continue;
                note.start -= this.patternSelectionStart;
                note.end -= this.patternSelectionStart;
                if (
                  note.start < 0 ||
                  note.end >
                    this.patternSelectionEnd - this.patternSelectionStart
                ) {
                  new ChangeNoteLength(
                    null,
                    note,
                    Math.max(note.start, 0),
                    Math.min(
                      this.patternSelectionEnd - this.patternSelectionStart,
                      note.end,
                    ),
                  );
                }
                notes.push(note);
              }
            } else {
              notes = pattern.notes;
            }
          }
          patterns[String(patternNumber)] = { notes: notes };
        }
      }

      const channelCopy: ChannelCopy = {
        isNoise: this._doc.song.getChannelIsNoise(channelIndex),
        patterns: patterns,
        bars: bars,
      };
      channels.push(channelCopy);
    }

    const selectionCopy: SelectionCopy = {
      partDuration: this.patternSelectionActive
        ? this.patternSelectionEnd - this.patternSelectionStart
        : this._doc.song.beatsPerBar * Config.partsPerBeat,
      channels: channels,
    };
    window.localStorage.setItem("selectionCopy", JSON.stringify(selectionCopy));
  }

  private _clearSelection(): void {
    new ChangePatternSelection(this._doc, 0, 0);
    this.resetBoxSelection();
  }

  public copy(): void {
    this._copy();
    this._clearSelection();
  }

  public cut(): void {
    this._copy();

    const group: ChangeGroup = new ChangeGroup();
    if (this.patternSelectionActive) {
      if (this.boxSelectionActive) {
        group.append(
          new ChangeDuplicateSelectedReusedPatterns(
            this._doc,
            this.boxSelectionBar,
            this.boxSelectionWidth,
            this.boxSelectionChannel,
            this.boxSelectionHeight,
          ),
        );
      }

      for (const channelIndex of this._eachSelectedChannel()) {
        for (const pattern of this._eachSelectedPattern(channelIndex)) {
          group.append(
            new ChangeNoteTruncate(
              this._doc,
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
          this._doc,
          0,
          this.boxSelectionBar,
          this.boxSelectionChannel,
          this.boxSelectionWidth,
          this.boxSelectionHeight,
        ),
      );
    }

    this._doc.record(group);
    this._clearSelection();
  }

  // I'm sorry this function is so complicated!
  // Basically I'm trying to avoid accidentally modifying patterns that are used
  // elsewhere in the song (unless we're just pasting a single pattern) but I'm
  // also trying to reuse patterns where it makes sense to do so, especially
  // in the same channel it was copied from.
  public pasteNotes(): void {
    const selectionCopy: SelectionCopy | null = JSON.parse(
      String(window.localStorage.getItem("selectionCopy")),
    );
    if (selectionCopy == null) {
      this._clearSelection();
      return;
    }
    const channelCopies: ChannelCopy[] = selectionCopy["channels"] || [];
    const copiedPartDuration: number = selectionCopy["partDuration"] >>> 0;

    const group: ChangeGroup = new ChangeGroup();
    const fillSelection: boolean = this.boxSelectionActive;

    const pasteHeight: number = fillSelection
      ? this.boxSelectionHeight
      : Math.min(
          channelCopies.length,
          this._doc.song.getChannelCount() - this.boxSelectionChannel,
        );
    for (
      let pasteChannel: number = 0;
      pasteChannel < pasteHeight;
      pasteChannel++
    ) {
      const channelCopy: ChannelCopy =
        channelCopies[pasteChannel % channelCopies.length];
      const channelIndex: number = this.boxSelectionChannel + pasteChannel;

      const isNoise: boolean = !!channelCopy["isNoise"];
      const patternCopies: Dictionary<PatternCopy> =
        channelCopy["patterns"] || {};
      const copiedBars: number[] = channelCopy["bars"] || [];
      if (copiedBars.length == 0) continue;
      if (isNoise != this._doc.song.getChannelIsNoise(channelIndex)) continue;

      const pasteWidth: number = fillSelection
        ? this.boxSelectionWidth
        : Math.min(
            copiedBars.length,
            this._doc.song.barCount - this.boxSelectionBar,
          );
      if (
        !fillSelection &&
        copiedBars.length == 1 &&
        channelCopies.length == 1
      ) {
        // Special case: if there's just one pattern being copied, try to insert it
        // into whatever pattern is already selected.
        const copiedPatternIndex: number = copiedBars[0] >>> 0;
        const bar: number = this.boxSelectionBar;
        const currentPatternIndex: number =
          this._doc.song.channels[channelIndex].bars[bar];
        if (copiedPatternIndex == 0 && currentPatternIndex == 0) continue;

        const patternCopy: PatternCopy =
          patternCopies[String(copiedPatternIndex)];
        if (currentPatternIndex == 0) {
          const existingPattern: Pattern | undefined =
            this._doc.song.channels[channelIndex].patterns[
              copiedPatternIndex - 1
            ];
          if (
            existingPattern != undefined &&
            !this.patternSelectionActive &&
            (comparePatternNotes(patternCopy["notes"], existingPattern.notes) ||
              this._patternIndexIsUnused(channelIndex, copiedPatternIndex))
          ) {
            group.append(
              new ChangePatternNumbers(
                this._doc,
                copiedPatternIndex,
                bar,
                channelIndex,
                1,
                1,
              ),
            );
          } else {
            group.append(
              new ChangeEnsurePatternExists(this._doc, channelIndex, bar),
            );
          }
        }

        const pattern: Pattern | null = this._doc.song.getPattern(
          channelIndex,
          bar,
        );
        if (pattern == null) throw new Error();
        group.append(
          new ChangePaste(
            this._doc,
            pattern,
            patternCopy["notes"],
            this.patternSelectionActive ? this.patternSelectionStart : 0,
            this.patternSelectionActive
              ? this.patternSelectionEnd
              : Config.partsPerBeat * this._doc.song.beatsPerBar,
            copiedPartDuration,
          ),
        );
      } else if (this.patternSelectionActive) {
        const reusablePatterns: Dictionary<number> = {};
        const usedPatterns: Dictionary<boolean> = {};

        group.append(
          new ChangeDuplicateSelectedReusedPatterns(
            this._doc,
            this.boxSelectionBar,
            pasteWidth,
            this.boxSelectionChannel,
            pasteHeight,
          ),
        );

        for (let pasteBar: number = 0; pasteBar < pasteWidth; pasteBar++) {
          const bar: number = this.boxSelectionBar + pasteBar;
          const copiedPatternIndex: number =
            copiedBars[pasteBar % copiedBars.length] >>> 0;
          const currentPatternIndex: number =
            this._doc.song.channels[channelIndex].bars[bar];
          const reusedIndex: string = [
            copiedPatternIndex,
            currentPatternIndex,
          ].join(",");
          if (copiedPatternIndex == 0 && currentPatternIndex == 0) continue;
          if (reusablePatterns[reusedIndex] != undefined) {
            group.append(
              new ChangePatternNumbers(
                this._doc,
                reusablePatterns[reusedIndex],
                bar,
                channelIndex,
                1,
                1,
              ),
            );
            continue;
          }

          if (currentPatternIndex == 0) {
            group.append(
              new ChangeEnsurePatternExists(this._doc, channelIndex, bar),
            );
          } else {
            const pattern: Pattern | null = this._doc.song.getPattern(
              channelIndex,
              bar,
            );
            if (pattern == null) throw new Error();

            if (!usedPatterns[String(currentPatternIndex)]) {
              usedPatterns[String(currentPatternIndex)] = true;
            } else {
              // If this pattern is used here and elsewhere, it's not safe to modify it directly, so
              // make a duplicate of it and modify that instead.
              group.append(
                new ChangePatternNumbers(this._doc, 0, bar, channelIndex, 1, 1),
              );
              group.append(
                new ChangeEnsurePatternExists(this._doc, channelIndex, bar),
              );
              const newPattern: Pattern | null = this._doc.song.getPattern(
                channelIndex,
                bar,
              );
              if (newPattern == null) throw new Error();
              for (const note of pattern.cloneNotes()) {
                group.append(
                  new ChangeNoteAdded(
                    this._doc,
                    newPattern,
                    note,
                    newPattern.notes.length,
                    false,
                  ),
                );
              }
            }
          }

          const pattern: Pattern | null = this._doc.song.getPattern(
            channelIndex,
            bar,
          );
          if (pattern == null) throw new Error();
          if (copiedPatternIndex == 0) {
            group.append(
              new ChangeNoteTruncate(
                this._doc,
                pattern,
                this.patternSelectionStart,
                this.patternSelectionEnd,
              ),
            );
          } else {
            const patternCopy: PatternCopy =
              patternCopies[String(copiedPatternIndex)];
            group.append(
              new ChangePaste(
                this._doc,
                pattern,
                patternCopy["notes"],
                this.patternSelectionStart,
                this.patternSelectionEnd,
                copiedPartDuration,
              ),
            );
          }

          reusablePatterns[reusedIndex] =
            this._doc.song.channels[channelIndex].bars[bar];
        }
      } else {
        for (let pasteBar: number = 0; pasteBar < pasteWidth; pasteBar++) {
          // When a pattern becomes unused when replaced by rectangular selection pasting,
          // remove all the notes from the pattern so that it may be reused.
          this.erasePatternInBar(
            group,
            channelIndex,
            this.boxSelectionBar + pasteBar,
          );
        }

        const reusablePatterns: Dictionary<number> = {};
        for (let pasteBar: number = 0; pasteBar < pasteWidth; pasteBar++) {
          const bar: number = this.boxSelectionBar + pasteBar;
          const copiedPatternIndex: number =
            copiedBars[pasteBar % copiedBars.length] >>> 0;
          const reusedIndex: string = String(copiedPatternIndex);

          if (copiedPatternIndex == 0) continue;
          if (reusablePatterns[reusedIndex] != undefined) {
            group.append(
              new ChangePatternNumbers(
                this._doc,
                reusablePatterns[reusedIndex],
                bar,
                channelIndex,
                1,
                1,
              ),
            );
            continue;
          }

          const patternCopy: PatternCopy =
            patternCopies[String(copiedPatternIndex)];
          const existingPattern: Pattern | undefined =
            this._doc.song.channels[channelIndex].patterns[
              copiedPatternIndex - 1
            ];

          if (
            existingPattern != undefined &&
            copiedPartDuration ==
              Config.partsPerBeat * this._doc.song.beatsPerBar &&
            comparePatternNotes(patternCopy["notes"], existingPattern.notes)
          ) {
            group.append(
              new ChangePatternNumbers(
                this._doc,
                copiedPatternIndex,
                bar,
                channelIndex,
                1,
                1,
              ),
            );
          } else {
            if (
              existingPattern != undefined &&
              this._patternIndexIsUnused(channelIndex, copiedPatternIndex)
            ) {
              group.append(
                new ChangePatternNumbers(
                  this._doc,
                  copiedPatternIndex,
                  bar,
                  channelIndex,
                  1,
                  1,
                ),
              );
            } else {
              group.append(
                new ChangeEnsurePatternExists(this._doc, channelIndex, bar),
              );
            }
            const pattern: Pattern | null = this._doc.song.getPattern(
              channelIndex,
              bar,
            );
            if (pattern == null) throw new Error();
            group.append(
              new ChangePaste(
                this._doc,
                pattern,
                patternCopy["notes"],
                this.patternSelectionActive ? this.patternSelectionStart : 0,
                this.patternSelectionActive
                  ? this.patternSelectionEnd
                  : Config.partsPerBeat * this._doc.song.beatsPerBar,
                copiedPartDuration,
              ),
            );
          }

          reusablePatterns[reusedIndex] =
            this._doc.song.channels[channelIndex].bars[bar];
        }
      }
    }

    this._doc.record(group);
    this._clearSelection();
  }

  // Set a bar's pattern number to zero, and if that pattern was not used
  // elsewhere in the channel, erase all notes in it as well.
  public erasePatternInBar(
    group: ChangeGroup,
    channelIndex: number,
    bar: number,
  ): void {
    const removedPattern: number =
      this._doc.song.channels[channelIndex].bars[bar];
    if (removedPattern != 0) {
      group.append(
        new ChangePatternNumbers(this._doc, 0, bar, channelIndex, 1, 1),
      );
      if (this._patternIndexIsUnused(channelIndex, removedPattern)) {
        // When a pattern becomes unused when replaced by rectangular selection pasting,
        // remove all the notes from the pattern so that it may be reused.
        this._doc.song.channels[channelIndex].patterns[
          removedPattern - 1
        ].notes.length = 0;
      }
    }
  }

  public pasteNumbers(): void {
    const selectionCopy: SelectionCopy | null = JSON.parse(
      String(window.localStorage.getItem("selectionCopy")),
    );
    if (selectionCopy == null) {
      this._clearSelection();
      return;
    }
    const channelCopies: ChannelCopy[] = selectionCopy["channels"] || [];

    const group: ChangeGroup = new ChangeGroup();
    const fillSelection: boolean = this.boxSelectionActive;

    const pasteHeight: number = fillSelection
      ? this.boxSelectionHeight
      : Math.min(
          channelCopies.length,
          this._doc.song.getChannelCount() - this.boxSelectionChannel,
        );
    for (
      let pasteChannel: number = 0;
      pasteChannel < pasteHeight;
      pasteChannel++
    ) {
      const channelCopy: ChannelCopy =
        channelCopies[pasteChannel % channelCopies.length];
      const channelIndex: number = this.boxSelectionChannel + pasteChannel;

      const copiedBars: number[] = channelCopy["bars"] || [];
      if (copiedBars.length == 0) continue;

      const pasteWidth: number = fillSelection
        ? this.boxSelectionWidth
        : Math.min(
            copiedBars.length,
            this._doc.song.barCount - this.boxSelectionBar,
          );
      for (let pasteBar: number = 0; pasteBar < pasteWidth; pasteBar++) {
        const copiedPatternIndex: number =
          copiedBars[pasteBar % copiedBars.length] >>> 0;
        const bar: number = this.boxSelectionBar + pasteBar;

        if (copiedPatternIndex > this._doc.song.patternsPerChannel) {
          group.append(
            new ChangePatternsPerChannel(this._doc, copiedPatternIndex),
          );
        }

        group.append(
          new ChangePatternNumbers(
            this._doc,
            copiedPatternIndex,
            bar,
            channelIndex,
            1,
            1,
          ),
        );
      }
    }

    this._doc.record(group);
    this._clearSelection();
  }

  public selectAll(): void {
    new ChangePatternSelection(this._doc, 0, 0);
    if (
      this.boxSelectionBar == 0 &&
      this.boxSelectionChannel == 0 &&
      this.boxSelectionWidth == this._doc.song.barCount &&
      this.boxSelectionHeight == this._doc.song.getChannelCount()
    ) {
      this.setTrackSelection(
        this._doc.bar,
        this._doc.bar,
        this._doc.channel,
        this._doc.channel,
      );
    } else {
      this.setTrackSelection(
        0,
        this._doc.song.barCount - 1,
        0,
        this._doc.song.getChannelCount() - 1,
      );
    }
    this.selectionUpdated();
  }

  public selectChannel(): void {
    new ChangePatternSelection(this._doc, 0, 0);
    if (
      this.boxSelectionBar == 0 &&
      this.boxSelectionWidth == this._doc.song.barCount
    ) {
      this.setTrackSelection(
        this._doc.bar,
        this._doc.bar,
        this.boxSelectionY0,
        this.boxSelectionY1,
      );
    } else {
      this.setTrackSelection(
        0,
        this._doc.song.barCount - 1,
        this.boxSelectionY0,
        this.boxSelectionY1,
      );
    }
    this.selectionUpdated();
  }

  public duplicatePatterns(): void {
    this._doc.record(
      new ChangeDuplicateSelectedReusedPatterns(
        this._doc,
        this.boxSelectionBar,
        this.boxSelectionWidth,
        this.boxSelectionChannel,
        this.boxSelectionHeight,
      ),
    );
  }

  public muteChannels(allChannels: boolean): void {
    if (allChannels) {
      let anyMuted: boolean = false;
      for (
        let channelIndex: number = 0;
        channelIndex < this._doc.song.channels.length;
        channelIndex++
      ) {
        if (this._doc.song.channels[channelIndex].muted) {
          anyMuted = true;
          break;
        }
      }
      for (
        let channelIndex: number = 0;
        channelIndex < this._doc.song.channels.length;
        channelIndex++
      ) {
        this._doc.song.channels[channelIndex].muted = !anyMuted;
      }
    } else {
      let anyUnmuted: boolean = false;
      for (const channelIndex of this._eachSelectedChannel()) {
        if (!this._doc.song.channels[channelIndex].muted) {
          anyUnmuted = true;
          break;
        }
      }
      for (const channelIndex of this._eachSelectedChannel()) {
        this._doc.song.channels[channelIndex].muted = anyUnmuted;
      }
    }

    this._doc.notifier.changed();
  }

  public soloChannels(invert: boolean): void {
    let alreadySoloed: boolean = true;

    for (
      let channelIndex: number = 0;
      channelIndex < this._doc.song.channels.length;
      channelIndex++
    ) {
      const shouldBeMuted: boolean =
        channelIndex < this.boxSelectionChannel ||
        channelIndex >= this.boxSelectionChannel + this.boxSelectionHeight
          ? !invert
          : invert;
      if (this._doc.song.channels[channelIndex].muted != shouldBeMuted) {
        alreadySoloed = false;
        break;
      }
    }

    if (alreadySoloed) {
      for (
        let channelIndex: number = 0;
        channelIndex < this._doc.song.channels.length;
        channelIndex++
      ) {
        this._doc.song.channels[channelIndex].muted = false;
      }
    } else {
      for (
        let channelIndex: number = 0;
        channelIndex < this._doc.song.channels.length;
        channelIndex++
      ) {
        this._doc.song.channels[channelIndex].muted =
          channelIndex < this.boxSelectionChannel ||
          channelIndex >= this.boxSelectionChannel + this.boxSelectionHeight
            ? !invert
            : invert;
      }
    }

    this._doc.notifier.changed();
  }

  public forceRhythm(): void {
    const group: ChangeGroup = new ChangeGroup();

    if (this.boxSelectionActive) {
      group.append(
        new ChangeDuplicateSelectedReusedPatterns(
          this._doc,
          this.boxSelectionBar,
          this.boxSelectionWidth,
          this.boxSelectionChannel,
          this.boxSelectionHeight,
        ),
      );
    }

    for (const channelIndex of this._eachSelectedChannel()) {
      for (const pattern of this._eachSelectedPattern(channelIndex)) {
        group.append(new ChangePatternRhythm(this._doc, pattern));
      }
    }

    this._doc.record(group);
  }

  public setTrackSelection(
    newX0: number,
    newX1: number,
    newY0: number,
    newY1: number,
  ): void {
    const canReplaceLastChange: boolean = this._doc.lastChangeWas(
      this._changeTrack,
    );
    this._changeTrack = new ChangeGroup();
    this._changeTrack.append(
      new ChangeTrackSelection(this._doc, newX0, newX1, newY0, newY1),
    );
    // Don't erase existing redo history just to change track selection.
    if (!this._doc.hasRedoHistory()) {
      this._doc.record(this._changeTrack, canReplaceLastChange);
    } else {
      this._doc.updateCurrentHistoryEntry();
    }
  }

  public transpose(upward: boolean, octave: boolean): void {
    const canReplaceLastChange: boolean = this._doc.lastChangeWas(
      this._changeTranspose,
    );
    this._changeTranspose = new ChangeGroup();

    if (this.boxSelectionActive) {
      this._changeTranspose.append(
        new ChangeDuplicateSelectedReusedPatterns(
          this._doc,
          this.boxSelectionBar,
          this.boxSelectionWidth,
          this.boxSelectionChannel,
          this.boxSelectionHeight,
        ),
      );
    }

    for (const channelIndex of this._eachSelectedChannel()) {
      for (const pattern of this._eachSelectedPattern(channelIndex)) {
        this._changeTranspose.append(
          new ChangeTranspose(
            this._doc,
            channelIndex,
            pattern,
            upward,
            this._doc.prefs.notesOutsideScale,
            octave,
          ),
        );
      }
    }

    this._doc.record(this._changeTranspose, canReplaceLastChange);
  }

  public swapChannels(offset: number): void {
    const possibleSectionBoundaries: number[] = [
      this._doc.song.pitchChannelCount,
      this._doc.song.pitchChannelCount + this._doc.song.noiseChannelCount,
      this._doc.song.getChannelCount(),
    ];
    let channelSectionMin: number = 0;
    let channelSectionMax: number = 0;
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
    const newSelectionMin: number = Math.max(
      this.boxSelectionChannel,
      channelSectionMin,
    );
    const newSelectionMax: number = Math.min(
      this.boxSelectionChannel + this.boxSelectionHeight - 1,
      channelSectionMax,
    );
    offset = Math.max(offset, channelSectionMin - newSelectionMin);
    offset = Math.min(offset, channelSectionMax - newSelectionMax);

    if (offset != 0) {
      const canReplaceLastChange: boolean = this._doc.lastChangeWas(
        this._changeReorder,
      );
      this._changeReorder = new ChangeGroup();
      this.boxSelectionY0 = newSelectionMin + offset;
      this.boxSelectionY1 = newSelectionMax + offset;
      this._changeReorder.append(
        new ChangeChannelOrder(
          this._doc,
          newSelectionMin,
          newSelectionMax,
          offset,
        ),
      );
      this._changeReorder.append(
        new ChangeChannelBar(
          this._doc,
          Math.max(
            this.boxSelectionY0,
            Math.min(this.boxSelectionY1, this._doc.channel + offset),
          ),
          this._doc.bar,
        ),
      );
      this.selectionUpdated();
      this._doc.record(this._changeReorder, canReplaceLastChange);
    }
  }

  public selectInstrument(instrument: number): void {
    if (this._doc.viewedInstrument[this._doc.channel] != instrument) {
      const canReplaceLastChange: boolean = this._doc.lastChangeWas(
        this._changeInstrument,
      );
      this._changeInstrument = new ChangeGroup();
      this._changeInstrument.append(
        new ChangeViewInstrument(this._doc, instrument),
      );
      if (!this._doc.hasRedoHistory()) {
        // Don't erase existing redo history just to look at highlighted pattern.
        this._doc.record(this._changeInstrument, canReplaceLastChange);
      } else {
        this._doc.updateCurrentHistoryEntry();
      }
    }
  }

  public resetBoxSelection(): void {
    this.boxSelectionX0 = this.boxSelectionX1 = this._doc.bar;
    this.boxSelectionY0 = this.boxSelectionY1 = this._doc.channel;
  }
}
