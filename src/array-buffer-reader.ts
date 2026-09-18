// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

// Note: All methods are big endian.
export class ArrayBufferReader {
  #readIndex = 0;
  #data: DataView;

  public constructor(data: DataView) {
    this.#data = data;
  }

  public getReadIndex(): number {
    return this.#readIndex;
  }

  public readUint32(): number {
    if (this.#readIndex + 4 > this.#data.byteLength) {
      throw new Error("Reading past the end of the buffer.");
    }
    const result: number = this.#data.getUint32(this.#readIndex, false);
    this.#readIndex += 4;
    return result;
  }

  public readUint24(): number {
    return (this.readUint8() << 16) | (this.readUint8() << 8) | this.readUint8();
  }

  public readUint16(): number {
    if (this.#readIndex + 2 > this.#data.byteLength) {
      throw new Error("Reading past the end of the buffer.");
    }
    const result: number = this.#data.getUint16(this.#readIndex, false);
    this.#readIndex += 2;
    return result;
  }

  public readUint8(): number {
    if (this.#readIndex + 1 > this.#data.byteLength) {
      throw new Error("Reading past the end of the buffer.");
    }
    const result: number = this.#data.getUint8(this.#readIndex);
    this.#readIndex++;
    return result;
  }

  public readInt8(): number {
    if (this.#readIndex + 1 > this.#data.byteLength) {
      throw new Error("Reading past the end of the buffer.");
    }
    const result: number = this.#data.getInt8(this.#readIndex);
    this.#readIndex++;
    return result;
  }

  public peakUint8(): number {
    if (this.#readIndex + 1 > this.#data.byteLength) {
      throw new Error("Reading past the end of the buffer.");
    }
    return this.#data.getUint8(this.#readIndex);
  }

  public readMidi7Bits(): number {
    const result: number = this.readUint8();
    if (result >= 0x80) {
      console.log(`7 bit value contained 8th bit! value ${result}, index ${this.#readIndex}`);
    }
    return result & 0x7f;
  }

  public readMidiVariableLength(): number {
    let result = 0;
    for (let i = 0; i < 4; i++) {
      const nextByte: number = this.readUint8();
      result += nextByte & 0x7f;
      if (nextByte & 0x80) {
        result <<= 7;
      } else {
        break;
      }
    }
    return result;
  }

  public skipBytes(length: number): void {
    this.#readIndex += length;
  }

  public hasMore(): boolean {
    return this.#data.byteLength > this.#readIndex;
  }

  public getReaderForNextBytes(length: number): ArrayBufferReader {
    if (this.#readIndex + length > this.#data.byteLength) {
      throw new Error("Reading past the end of the buffer.");
    }
    const result: ArrayBufferReader = new ArrayBufferReader(
      new DataView(this.#data.buffer, this.#data.byteOffset + this.#readIndex, length),
    );
    this.skipBytes(length);
    return result;
  }
}
