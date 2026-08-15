// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { deflateSync, Inflate } from "fflate";
import { decodeBinaryValue, encodeBinaryValue } from "./BinaryCodec.js";

const magic: ReadonlyArray<number> = [0x53, 0x4c, 0x44, 0x47]; // SLDG
const currentVersion: number = 1;
const headerLength: number = 5;
const checksumLength: number = 4;
const maximumBodyLength: number = 64 * 1024 * 1024;
const maximumCompressedBodyLength: number = maximumBodyLength + 64 * 1024;

const compressionDictionaryText: string = [
  "asset:https://",
  "https://dl.dropboxusercontent.com/scl/fi/",
  "https://raw.githubusercontent.com/",
  "https://cdn.jsdelivr.net/",
  "https://storage.googleapis.com/",
  "https://drive.google.com/",
  ".sf2",
  ".wav",
  ".mp3",
  ".ogg",
  "?rlkey=",
  "&st=",
].join("");
const compressionDictionary: Uint8Array = Uint8Array.from(
  compressionDictionaryText,
  (character: string): number => character.charCodeAt(0),
);
export const maximumSongBinaryLength: number =
  headerLength + maximumCompressedBodyLength + checksumLength;

const crcTable: Uint32Array = (() => {
  const table: Uint32Array = new Uint32Array(256);
  for (let index: number = 0; index < table.length; index++) {
    let value: number = index;
    for (let bit: number = 0; bit < 8; bit++) {
      value = (value & 1) != 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let checksum: number = 0xffffffff;
  for (const byte of bytes)
    checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function inflateBody(compressed: Uint8Array): Uint8Array {
  if (compressed.length > maximumCompressedBodyLength)
    throw new RangeError("Song data is too large.");
  const chunks: Uint8Array[] = [];
  let totalLength: number = 0;
  const inflater: Inflate = new Inflate(
    { dictionary: compressionDictionary },
    (chunk: Uint8Array): void => {
      totalLength += chunk.length;
      if (totalLength > maximumBodyLength)
        throw new RangeError("Song data is too large.");
      chunks.push(chunk);
    },
  );
  const inputChunkLength: number = 4 * 1024;
  for (
    let offset: number = 0;
    offset < compressed.length;
    offset += inputChunkLength
  ) {
    const end: number = Math.min(compressed.length, offset + inputChunkLength);
    inflater.push(compressed.subarray(offset, end), end == compressed.length);
  }
  if (compressed.length == 0) inflater.push(compressed, true);
  const result: Uint8Array = new Uint8Array(totalLength);
  let offset: number = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function encodeSongBinary(value: unknown): Uint8Array {
  const body: Uint8Array = encodeBinaryValue(value, true);
  if (body.length > maximumBodyLength)
    throw new RangeError("Song data is too large.");
  const compressed: Uint8Array = deflateSync(body, {
    level: 9,
    dictionary: compressionDictionary,
  });
  if (compressed.length > maximumCompressedBodyLength)
    throw new RangeError("Song data is too large.");

  const result: Uint8Array = new Uint8Array(
    headerLength + compressed.length + checksumLength,
  );
  result.set(magic, 0);
  result[4] = currentVersion;
  result.set(compressed, headerLength);
  const view: DataView = new DataView(result.buffer);
  view.setUint32(
    result.length - checksumLength,
    crc32(result.subarray(0, result.length - checksumLength)),
  );
  return result;
}

export function extractCompressedSongBody(
  bytes: Uint8Array,
): Uint8Array | null {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("Song data must be a Uint8Array.");
  if (bytes.length <= headerLength + checksumLength) return null;
  for (let index: number = 0; index < magic.length; index++)
    if (bytes[index] != magic[index]) return null;
  if (bytes[4] != currentVersion) return null;
  if (bytes.length > maximumSongBinaryLength)
    throw new RangeError("Song data is too large.");
  const checksumOffset: number = bytes.length - checksumLength;
  const view: DataView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  if (
    view.getUint32(checksumOffset) != crc32(bytes.subarray(0, checksumOffset))
  )
    throw new Error("Corrupt .goop file checksum.");
  return bytes.slice(headerLength, checksumOffset);
}

export function restoreCompressedSongBody(compressed: Uint8Array): Uint8Array {
  if (!(compressed instanceof Uint8Array))
    throw new TypeError("Song data must be a Uint8Array.");
  if (compressed.length > maximumCompressedBodyLength)
    throw new RangeError("Song data is too large.");
  const result: Uint8Array = new Uint8Array(
    headerLength + compressed.length + checksumLength,
  );
  result.set(magic, 0);
  result[4] = currentVersion;
  result.set(compressed, headerLength);
  new DataView(result.buffer).setUint32(
    result.length - checksumLength,
    crc32(result.subarray(0, result.length - checksumLength)),
  );
  return result;
}

export function decodeSongBinary(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("Song data must be a Uint8Array.");
  if (bytes.length <= headerLength + checksumLength)
    throw new Error("Truncated .goop file.");
  for (let index: number = 0; index < magic.length; index++) {
    if (bytes[index] != magic[index])
      throw new Error("Invalid .goop file signature.");
  }
  if (bytes[4] != currentVersion)
    throw new Error(`Unsupported .goop version: ${bytes[4]}.`);
  if (bytes.length > maximumSongBinaryLength)
    throw new RangeError("Song data is too large.");

  const checksumOffset: number = bytes.length - checksumLength;
  const view: DataView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const expectedChecksum: number = view.getUint32(checksumOffset);
  const actualChecksum: number = crc32(bytes.subarray(0, checksumOffset));
  if (actualChecksum != expectedChecksum)
    throw new Error("Corrupt .goop file checksum.");
  return decodeBinaryValue(
    inflateBody(bytes.subarray(headerLength, checksumOffset)),
  );
}
