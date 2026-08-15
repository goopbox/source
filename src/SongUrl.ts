// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import {
  extractCompressedSongBody,
  maximumSongBinaryLength,
  restoreCompressedSongBody,
} from "../synth/SongBinary.js";

const songUrlPattern: RegExp = /^#([A-Za-z0-9_-]+)$/;
const base64UrlAlphabet: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const maximumBase64UrlLength: number = Math.ceil(
  (maximumSongBinaryLength * 4) / 3,
);

function bytesToBase64Url(bytes: Uint8Array): string {
  let base64: string = "";
  for (let index: number = 0; index < bytes.length; index += 3) {
    const first: number = bytes[index];
    const second: number | undefined = bytes[index + 1];
    const third: number | undefined = bytes[index + 2];
    base64 += base64UrlAlphabet[first >> 2];
    base64 += base64UrlAlphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined)
      base64 += base64UrlAlphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    if (third !== undefined) base64 += base64UrlAlphabet[third & 63];
  }
  return base64;
}

function base64UrlToBytes(base64: string): Uint8Array {
  if (base64.length % 4 == 1) throw new Error("Invalid song URL payload.");
  if (base64.length > maximumBase64UrlLength)
    throw new RangeError("Song URL payload is too large.");
  const bytes: Uint8Array = new Uint8Array(Math.floor((base64.length * 3) / 4));
  let byteIndex: number = 0;
  for (let index: number = 0; index < base64.length; index += 4) {
    const first: number = base64UrlAlphabet.indexOf(base64[index]);
    const second: number = base64UrlAlphabet.indexOf(base64[index + 1]);
    const third: number =
      base64[index + 2] === undefined
        ? 0
        : base64UrlAlphabet.indexOf(base64[index + 2]);
    const fourth: number =
      base64[index + 3] === undefined
        ? 0
        : base64UrlAlphabet.indexOf(base64[index + 3]);
    if (first < 0 || second < 0 || third < 0 || fourth < 0)
      throw new Error("Invalid song URL payload.");
    bytes[byteIndex++] = (first << 2) | (second >> 4);
    if (index + 2 < base64.length)
      bytes[byteIndex++] = ((second & 15) << 4) | (third >> 2);
    if (index + 3 < base64.length)
      bytes[byteIndex++] = ((third & 3) << 6) | fourth;
  }
  if (bytesToBase64Url(bytes) != base64)
    throw new Error("Invalid song URL payload.");
  return bytes;
}

export function encodeSongUrl(song: Uint8Array): string {
  if (song.length > maximumSongBinaryLength)
    throw new RangeError("Song URL payload is too large.");
  const compressedBody: Uint8Array | null = extractCompressedSongBody(song);
  if (compressedBody == null)
    throw new Error("Invalid or unsupported .goop song data.");
  return `#${bytesToBase64Url(compressedBody)}`;
}

export function decodeSongUrlHash(hash: string): Uint8Array | null {
  if (hash == "") return null;
  const match: RegExpExecArray | null = songUrlPattern.exec(hash);
  if (match == null) return null;
  return restoreCompressedSongBody(base64UrlToBytes(match[1]));
}

export function decodeSongUrl(): Uint8Array | null {
  return decodeSongUrlHash(window.location.hash);
}
