// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config } from "../synth/SynthConfig.js";
import { Song } from "../synth/synth.js";
import { encodeSongUrl } from "./SongUrl.js";

export interface RecoveredVersion {
  uid: string;
  time: number;
  work: number;
}

export interface RecoveredSong {
  versions: RecoveredVersion[];
}

const versionPrefix = "songBinaryVersion: ";
const maximumSongCount = 8;
const maximumWorkPerVersion = 3 * 60 * 1000; // 3 minutes
const minimumWorkPerSpan = 1 * 60 * 1000; // 1 minute

function keyIsVersion(key: string): boolean {
  return key.indexOf(versionPrefix) == 0;
}

function keyToVersion(key: string): RecoveredVersion | null {
  try {
    const candidate: unknown = JSON.parse(key.substring(versionPrefix.length));
    if (
      candidate == null ||
      typeof candidate != "object" ||
      Array.isArray(candidate)
    ) {
      return null;
    }
    const version: Partial<RecoveredVersion> = candidate;
    return typeof version.uid == "string" &&
      version.uid.length > 0 &&
      typeof version.time == "number" &&
      Number.isFinite(version.time) &&
      version.time >= 0 &&
      typeof version.work == "number" &&
      Number.isFinite(version.work) &&
      version.work >= 0
      ? (version as RecoveredVersion)
      : null;
  } catch {
    return null;
  }
}

export function versionToKey(version: RecoveredVersion): string {
  return versionPrefix + JSON.stringify(version);
}

export function generateUid(): string {
  // Not especially robust, but simple and effective!
  return ((Math.random() * (-1 >>> 0)) >>> 0).toString(32);
}

export function errorAlert(error: any): void {
  console.warn(error);
  window.alert(
    'Ah crud. Report the error in your DevTools console, please. Try "Recover..." to restore a recent version.',
  );
}

function compareSongs(a: RecoveredSong, b: RecoveredSong): number {
  return b.versions[0].time - a.versions[0].time;
}

function compareVersions(a: RecoveredVersion, b: RecoveredVersion): number {
  return b.time - a.time;
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    error != null &&
    typeof error == "object" &&
    "name" in error &&
    error.name == "QuotaExceededError"
  );
}

function removeVersionFromSongs(
  songs: RecoveredSong[],
  version: RecoveredVersion,
): void {
  for (let songIndex: number = 0; songIndex < songs.length; songIndex++) {
    const versions: RecoveredVersion[] = songs[songIndex].versions;
    const versionIndex: number = versions.indexOf(version);
    if (versionIndex == -1) continue;
    versions.splice(versionIndex, 1);
    if (versions.length == 0) songs.splice(songIndex, 1);
    return;
  }
}

export class SongRecovery {
  private _saveVersionTimeoutHandle!: ReturnType<typeof setTimeout>;

  public constructor(
    private readonly _onHistoryLoss: (() => void) | null = null,
  ) {}

  public static getAllRecoveredSongs(): RecoveredSong[] {
    const songs: RecoveredSong[] = [];
    const songsByUid: Map<string, RecoveredSong> = new Map();
    let storageLength: number;
    try {
      storageLength = localStorage.length;
    } catch (error) {
      console.warn(error);
      return songs;
    }
    for (let i = 0; i < storageLength; i++) {
      let itemKey: string | null;
      try {
        itemKey = localStorage.key(i);
      } catch (error) {
        console.warn(error);
        break;
      }
      if (itemKey == null || !keyIsVersion(itemKey)) continue;
      const version: RecoveredVersion | null = keyToVersion(itemKey);
      if (version == null) {
        console.warn(`Ignoring malformed song recovery key: ${itemKey}`);
        continue;
      }
      let song: RecoveredSong | undefined = songsByUid.get(version.uid);
      if (song == undefined) {
        song = { versions: [] };
        songsByUid.set(version.uid, song);
        songs.push(song);
      }
      song.versions.push(version);
    }
    for (const song of songs) {
      song.versions.sort(compareVersions);
    }
    songs.sort(compareSongs);
    return songs;
  }

  public saveVersion(uid: string, songData: Uint8Array): void {
    const requestedTime: number = Math.round(Date.now());
    const savedSongData: Uint8Array = new Uint8Array(songData);

    clearTimeout(this._saveVersionTimeoutHandle);
    this._saveVersionTimeoutHandle = setTimeout((): void => {
      const previousChipWaves = Config.chipWaves;
      try {
        // Ensure that the song is not corrupted.
        new Song(savedSongData);
      } catch (error) {
        errorAlert(error);
        return;
      } finally {
        Config.chipWaves = previousChipWaves;
      }

      const songs: RecoveredSong[] = SongRecovery.getAllRecoveredSongs();
      let currentSong: RecoveredSong | null = null;
      for (const song of songs) {
        if (song.versions[0].uid == uid) {
          currentSong = song;
        }
      }
      if (currentSong == null) {
        currentSong = { versions: [] };
        songs.unshift(currentSong);
      }
      const versions: RecoveredVersion[] = currentSong.versions;

      let newWork: number = 1000; // default to 1 second of work for the first change.
      let newTime: number = requestedTime;
      if (versions.length > 0) {
        const mostRecentTime: number = versions[0].time;
        const mostRecentWork: number = versions[0].work;
        newTime = Math.max(newTime, mostRecentTime + 1);
        newWork =
          mostRecentWork +
          Math.min(maximumWorkPerVersion, newTime - mostRecentTime);
      }

      const newVersion: RecoveredVersion = {
        uid: uid,
        time: newTime,
        work: newWork,
      };
      const newKey: string = versionToKey(newVersion);
      const versionsByAge: RecoveredVersion[] = songs
        .flatMap((song: RecoveredSong): RecoveredVersion[] => song.versions)
        .sort(
          (a: RecoveredVersion, b: RecoveredVersion): number => a.time - b.time,
        );
      let firstQuotaError: unknown = null;
      while (true) {
        try {
          localStorage.setItem(newKey, encodeSongUrl(savedSongData));
          break;
        } catch (error) {
          if (!isQuotaExceededError(error) || versionsByAge.length == 0) {
            this._notifyHistoryLoss(firstQuotaError ?? error);
            return;
          }
          if (firstQuotaError == null) firstQuotaError = error;
          const versionToDiscard: RecoveredVersion = versionsByAge.shift()!;
          try {
            localStorage.removeItem(versionToKey(versionToDiscard));
          } catch (removalError) {
            this._notifyHistoryLoss(removalError);
            return;
          }
          removeVersionFromSongs(songs, versionToDiscard);
        }
      }
      if (firstQuotaError != null) this._notifyHistoryLoss(firstQuotaError);

      // Saving an existing song makes it the most recent song again. It may
      // have temporarily disappeared from the list if quota trimming removed
      // its last older version.
      const currentSongIndex: number = songs.indexOf(currentSong);
      if (currentSongIndex != -1) songs.splice(currentSongIndex, 1);
      songs.unshift(currentSong);
      versions.unshift(newVersion);

      // Consider deleting an old version to free up space.
      let minSpan: number = minimumWorkPerSpan; // start out with a gap between versions.
      const spanMult: number = Math.pow(2, 1 / 2); // Double the span every 2 versions back.
      for (var i: number = 1; i < versions.length; i++) {
        const currentWork: number = versions[i].work;
        const olderWork: number =
          i == versions.length - 1 ? 0.0 : versions[i + 1].work;
        // If not enough work happened between two versions, discard one of them.
        if (currentWork - olderWork < minSpan) {
          let indexToDiscard: number = i;
          if (i < versions.length - 1) {
            const currentTime: number = versions[i].time;
            const newerTime: number = versions[i - 1].time;
            const olderTime: number = versions[i + 1].time;
            // Weird heuristic: Between the three adjacent versions, prefer to keep
            // the newest and the oldest, discarding the middle one (i), unless
            // there is a large gap of time between the newest and middle one, in
            // which case the middle one represents the end of a span of work and is
            // thus more memorable.
            if (currentTime - olderTime < 0.5 * (newerTime - currentTime)) {
              indexToDiscard = i + 1;
            }
          }
          try {
            const discardedVersion: RecoveredVersion = versions[indexToDiscard];
            localStorage.removeItem(versionToKey(discardedVersion));
            removeVersionFromSongs(songs, discardedVersion);
          } catch (error) {
            console.warn(error);
          }
          break;
        }
        minSpan *= spanMult;
      }

      // If there are too many songs, discard the least important ones.
      // Songs that are older, or have less work, are less important.
      while (songs.length > maximumSongCount) {
        let leastImportantSong: RecoveredSong | null = null;
        let leastImportance: number = Number.POSITIVE_INFINITY;
        for (
          let i: number = Math.round(maximumSongCount / 2);
          i < songs.length;
          i++
        ) {
          const song: RecoveredSong = songs[i];
          const timePassed: number = newTime - song.versions[0].time;
          // Convert the time into a factor of 12 hours, add one, then divide by the result.
          // This creates a curve that starts at 1, and then gradually drops off.
          const timeScale: number =
            1.0 / (timePassed / (12 * 60 * 60 * 1000) + 1.0);
          // Add 5 minutes of work, to balance out simple songs a little bit.
          const adjustedWork: number = song.versions[0].work + 5 * 60 * 1000;
          const weight: number = adjustedWork * timeScale;
          if (leastImportance > weight) {
            leastImportance = weight;
            leastImportantSong = song;
          }
        }
        let removedSong: boolean = true;
        for (const version of leastImportantSong!.versions) {
          try {
            localStorage.removeItem(versionToKey(version));
          } catch (error) {
            console.warn(error);
            removedSong = false;
            break;
          }
        }
        if (!removedSong) break;
        songs.splice(songs.indexOf(leastImportantSong!), 1);
      }
    }, 750); // Wait 3/4 of a second before saving a version.
  }

  private _notifyHistoryLoss(error: unknown): void {
    console.warn(error);
    if (this._onHistoryLoss == null) return;
    try {
      this._onHistoryLoss();
    } catch (callbackError) {
      console.warn(callbackError);
    }
  }
}
