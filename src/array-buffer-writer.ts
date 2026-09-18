// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

function transfer(source: ArrayBuffer, length: number): ArrayBuffer {
  const dest: ArrayBuffer = new ArrayBuffer(length);
  let nextOffset = 0,
    leftBytes = Math.min(source.byteLength, dest.byteLength);
  function transferWith(
    wordSize: number,
    sourceBuffer: ArrayBuffer,
    destinationBuffer: ArrayBuffer,
    offset: number,
    remainingBytes: number,
  ) {
    let ViewClass:
      | Float64ArrayConstructor
      | Float32ArrayConstructor
      | Uint16ArrayConstructor
      | Uint8ArrayConstructor;
    switch (wordSize) {
      case 8: {
        ViewClass = Float64Array;
        break;
      }
      case 4: {
        ViewClass = Float32Array;
        break;
      }
      case 2: {
        ViewClass = Uint16Array;
        break;
      }
      case 1: {
        ViewClass = Uint8Array;
        break;
      }
      default: {
        ViewClass = Uint8Array;
        break;
      }
    }

    const view_source = new ViewClass(sourceBuffer, offset, (remainingBytes / wordSize) | 0),
      view_dest = new ViewClass(destinationBuffer, offset, (remainingBytes / wordSize) | 0);
    for (let i = 0; i < view_dest.length; i++) {
      view_dest[i] = view_source[i]!;
    }
    return {
      nextOffset: view_source.byteOffset + view_source.byteLength,
      leftBytes: remainingBytes - view_dest.length * wordSize,
    };
  }
  const wordSizes = [8, 4, 2, 1];
  for (const wordSize of wordSizes) {
    if (leftBytes >= wordSize) {
      const done = transferWith(wordSize, source, dest, nextOffset, leftBytes);
      nextOffset = done.nextOffset;
      leftBytes = done.leftBytes;
    }
  }
  return dest;
}

// Note: All methods are big endian.
export class ArrayBufferWriter {
  #writeIndex = 0;
  #fileSize = 0;
  #arrayBuffer: ArrayBuffer;
  #data: DataView;

  public constructor(initialCapacity: number) {
    this.#arrayBuffer = new ArrayBuffer(initialCapacity);
    this.#data = new DataView(this.#arrayBuffer);
  }

  #addBytes(numBytes: number): void {
    this.#fileSize += numBytes;
    if (this.#fileSize > this.#arrayBuffer.byteLength) {
      this.#arrayBuffer = transfer(
        this.#arrayBuffer,
        Math.max(this.#arrayBuffer.byteLength * 2, this.#fileSize),
      );
      this.#data = new DataView(this.#arrayBuffer);
    }
  }

  public getWriteIndex(): number {
    return this.#writeIndex;
  }

  public rewriteUint32(index: number, value: number): void {
    this.#data.setUint32(index, value >>> 0, false);
  }

  public writeUint32(value: number): void {
    value >>>= 0;
    this.#addBytes(4);
    this.#data.setUint32(this.#writeIndex, value, false);
    this.#writeIndex = this.#fileSize;
  }

  public writeUint24(value: number): void {
    value >>>= 0;
    this.#addBytes(3);
    this.#data.setUint8(this.#writeIndex, (value >> 16) & 0xff);
    this.#data.setUint8(this.#writeIndex + 1, (value >> 8) & 0xff);
    this.#data.setUint8(this.#writeIndex + 2, value & 0xff);
    this.#writeIndex = this.#fileSize;
  }

  public writeUint16(value: number): void {
    value >>>= 0;
    this.#addBytes(2);
    this.#data.setUint16(this.#writeIndex, value, false);
    this.#writeIndex = this.#fileSize;
  }

  public writeUint8(value: number): void {
    value >>>= 0;
    this.#addBytes(1);
    this.#data.setUint8(this.#writeIndex, value);
    this.#writeIndex = this.#fileSize;
  }

  public writeInt8(value: number): void {
    value |= 0;
    this.#addBytes(1);
    this.#data.setInt8(this.#writeIndex, value);
    this.#writeIndex = this.#fileSize;
  }

  public writeMidi7Bits(value: number): void {
    value >>>= 0;
    if (value >= 0x80) {
      throw new Error("7 bit value contained 8th bit!");
    }
    this.#addBytes(1);
    this.#data.setUint8(this.#writeIndex, value);
    this.#writeIndex = this.#fileSize;
  }

  public writeMidiVariableLength(value: number): void {
    value >>>= 0;
    if (value > 0x0f_ff_ff_ff) {
      throw new Error("writeVariableLength value too big.");
    }
    let startWriting = false;
    for (let i = 0; i < 4; i++) {
      const shift: number = 21 - i * 7,
        bits: number = (value >>> shift) & 0x7f;
      if (bits !== 0 || i === 3) {
        startWriting = true;
      } // Skip leading zero bytes, but always write the last byte even if it's zero.
      if (startWriting) {
        this.writeUint8((i === 3 ? 0x00 : 0x80) | bits);
      }
    }
  }

  public writeMidiAscii(string: string): void {
    this.writeMidiVariableLength(string.length);
    for (let i = 0; i < string.length; i++) {
      const charCode: number = string.charCodeAt(i);
      if (charCode > 0x7f) {
        throw new Error("Trying to write unicode character as ascii.");
      }
      this.writeUint8(charCode); // Technically charCodeAt returns 2 byte values, but this string should contain exclusively 1 byte values.
    }
  }

  public toCompactArrayBuffer(): ArrayBuffer {
    return transfer(this.#arrayBuffer, this.#fileSize);
  }
}
