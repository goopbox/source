// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

// This is a deliberately small, deterministic subset of MessagePack. It supports
// Exactly the value types used by song data. Song encoding can optionally store each
// Plain-object shape once, then encode objects positionally against those schemas.

const maximumNestingDepth = 100,
  maximumCollectionLength = 1_000_000,
  maximumStringByteLength: number = 16 * 1024 * 1024,
  maximumEncodedByteLength: number = 64 * 1024 * 1024;

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint: number = character.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7_ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xff_ff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length;) {
    const first: number = bytes[index++]!;
    if (first <= 0x7f) {
      result += String.fromCodePoint(first);
      continue;
    }

    let continuationCount: number, codePoint: number, minimumCodePoint: number;
    if (first >= 0xc2 && first <= 0xdf) {
      continuationCount = 1;
      codePoint = first & 0x1f;
      minimumCodePoint = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      continuationCount = 2;
      codePoint = first & 0x0f;
      minimumCodePoint = 0x8_00;
    } else if (first >= 0xf0 && first <= 0xf4) {
      continuationCount = 3;
      codePoint = first & 0x07;
      minimumCodePoint = 0x1_00_00;
    } else {
      throw new Error("Binary string contains invalid UTF-8.");
    }

    if (index + continuationCount > bytes.length) {
      throw new Error("Binary string contains invalid UTF-8.");
    }
    for (let continuationIndex = 0; continuationIndex < continuationCount; continuationIndex++) {
      const continuation: number = bytes[index++]!;
      if ((continuation & 0xc0) !== 0x80) {
        throw new Error("Binary string contains invalid UTF-8.");
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    if (
      codePoint < minimumCodePoint ||
      codePoint > 0x10_ff_ff ||
      (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
    ) {
      throw new Error("Binary string contains invalid UTF-8.");
    }
    result += String.fromCodePoint(codePoint);
  }
  return result;
}

const unsafeObjectKeys: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

class BinaryWriter {
  #bytes: Uint8Array = new Uint8Array(1024);
  #view: DataView = new DataView(this.#bytes.buffer);
  #length = 0;

  #ensureCapacity(additionalLength: number): void {
    const requiredLength: number = this.#length + additionalLength;
    if (requiredLength > maximumEncodedByteLength) {
      throw new RangeError("Binary value exceeds the maximum encoded size.");
    }

    if (requiredLength <= this.#bytes.length) {
      return;
    }
    let newLength: number = this.#bytes.length;
    while (newLength < requiredLength) {
      newLength = Math.min(maximumEncodedByteLength, newLength * 2);
    }
    const newBytes: Uint8Array = new Uint8Array(newLength);
    newBytes.set(this.#bytes);
    this.#bytes = newBytes;
    this.#view = new DataView(newBytes.buffer);
  }

  public writeByte(value: number): void {
    this.#ensureCapacity(1);
    this.#bytes[this.#length++] = value;
  }

  public writeUint16(value: number): void {
    this.#ensureCapacity(2);
    this.#view.setUint16(this.#length, value);
    this.#length += 2;
  }

  public writeUint32(value: number): void {
    this.#ensureCapacity(4);
    this.#view.setUint32(this.#length, value);
    this.#length += 4;
  }

  public writeBigUint64(value: bigint): void {
    this.#ensureCapacity(8);
    this.#view.setBigUint64(this.#length, value);
    this.#length += 8;
  }

  public writeFloat64(value: number): void {
    this.#ensureCapacity(8);
    this.#view.setFloat64(this.#length, value);
    this.#length += 8;
  }

  public writeBytes(value: Uint8Array): void {
    this.#ensureCapacity(value.length);
    this.#bytes.set(value, this.#length);
    this.#length += value.length;
  }

  public finish(): Uint8Array {
    return this.#bytes.slice(0, this.#length);
  }
}

function assertWellFormedString(value: string): void {
  if (value.length > maximumStringByteLength) {
    throw new RangeError("String exceeds the maximum encoded size.");
  }

  for (let index = 0; index < value.length; index++) {
    const codeUnit: number = value.charCodeAt(index);
    if (codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff) {
      const nextCodeUnit: number = value.charCodeAt(++index);
      if (!(nextCodeUnit >= 0xdc_00 && nextCodeUnit <= 0xdf_ff)) {
        throw new TypeError("Strings must contain valid Unicode scalar values.");
      }
    } else if (codeUnit >= 0xdc_00 && codeUnit <= 0xdf_ff) {
      throw new TypeError("Strings must contain valid Unicode scalar values.");
    }
  }
}

function writeString(writer: BinaryWriter, value: string): void {
  assertWellFormedString(value);
  const bytes: Uint8Array = encodeUtf8(value);
  if (bytes.length > maximumStringByteLength) {
    throw new RangeError("String exceeds the maximum encoded size.");
  }

  if (bytes.length <= 0x1f) {
    writer.writeByte(0xa0 | bytes.length);
  } else if (bytes.length <= 0xff) {
    writer.writeByte(0xd9);
    writer.writeByte(bytes.length);
  } else if (bytes.length <= 0xff_ff) {
    writer.writeByte(0xda);
    writer.writeUint16(bytes.length);
  } else {
    writer.writeByte(0xdb);
    writer.writeUint32(bytes.length);
  }
  writer.writeBytes(bytes);
}

function writeBinary(writer: BinaryWriter, value: Uint8Array): void {
  if (value.length <= 0xff) {
    writer.writeByte(0xc4);
    writer.writeByte(value.length);
  } else if (value.length <= 0xff_ff) {
    writer.writeByte(0xc5);
    writer.writeUint16(value.length);
  } else {
    writer.writeByte(0xc6);
    writer.writeUint32(value.length);
  }
  writer.writeBytes(value);
}

function writeNumber(writer: BinaryWriter, value: number): void {
  if (!Number.isFinite(value)) {
    throw new TypeError("Numbers must be finite.");
  }

  if (!Object.is(value, -0) && Number.isSafeInteger(value)) {
    if (value >= 0) {
      if (value <= 0x7f) {
        writer.writeByte(value);
      } else if (value <= 0xff) {
        writer.writeByte(0xcc);
        writer.writeByte(value);
      } else if (value <= 0xff_ff) {
        writer.writeByte(0xcd);
        writer.writeUint16(value);
      } else if (value <= 0xff_ff_ff_ff) {
        writer.writeByte(0xce);
        writer.writeUint32(value);
      } else {
        writer.writeByte(0xcf);
        writer.writeBigUint64(BigInt(value));
      }
    } else if (value >= -0x20) {
      writer.writeByte(value & 0xff);
    } else if (value >= -0x80) {
      writer.writeByte(0xd0);
      writer.writeByte(value & 0xff);
    } else if (value >= -0x80_00) {
      writer.writeByte(0xd1);
      writer.writeUint16(value & 0xff_ff);
    } else if (value >= -0x80_00_00_00) {
      writer.writeByte(0xd2);
      writer.writeUint32(value >>> 0);
    } else {
      writer.writeByte(0xd3);
      writer.writeBigUint64(BigInt.asUintN(64, BigInt(value)));
    }
    return;
  }

  writer.writeByte(0xcb);
  writer.writeFloat64(value);
}

function writeArrayHeader(writer: BinaryWriter, length: number): void {
  if (length <= 0x0f) {
    writer.writeByte(0x90 | length);
  } else if (length <= 0xff_ff) {
    writer.writeByte(0xdc);
    writer.writeUint16(length);
  } else {
    writer.writeByte(0xdd);
    writer.writeUint32(length);
  }
}

function writeMapHeader(writer: BinaryWriter, length: number): void {
  if (length <= 0x0f) {
    writer.writeByte(0x80 | length);
  } else if (length <= 0xff_ff) {
    writer.writeByte(0xde);
    writer.writeUint16(length);
  } else {
    writer.writeByte(0xdf);
    writer.writeUint32(length);
  }
}

function assertSafeObjectKey(key: string): void {
  if (unsafeObjectKeys.has(key)) {
    throw new TypeError(`Unsafe object key: ${key}.`);
  }
}

type ObjectSchema = readonly string[];

function schemaId(keys: readonly string[]): string {
  return JSON.stringify(keys);
}

function collectObjectSchemas(
  value: unknown,
  schemas: Map<string, string[]>,
  ancestors: WeakSet<object>,
  depth: number,
): void {
  if (depth > maximumNestingDepth) {
    throw new RangeError("Binary value is nested too deeply.");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Unsupported binary value type: ${typeof value}.`);
  }
  if (value instanceof Uint8Array) {
    return;
  }
  if (ancestors.has(value)) {
    throw new TypeError("Cyclic values cannot be encoded.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError("Only plain arrays can be encoded.");
      }
      if (value.length > maximumCollectionLength) {
        throw new RangeError("Array exceeds the maximum collection length.");
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError("Arrays cannot contain symbol-keyed properties.");
      }
      const descriptors: Record<string, PropertyDescriptor> =
        Object.getOwnPropertyDescriptors(value);
      if (Object.keys(descriptors).length !== value.length + 1) {
        throw new TypeError("Arrays must be dense and cannot have extra properties.");
      }
      for (let index = 0; index < value.length; index++) {
        const descriptor: PropertyDescriptor | undefined = descriptors[String(index)]!;
        if (descriptor == null || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("Arrays must contain enumerable data elements at every index.");
        }
        collectObjectSchemas(descriptor.value, schemas, ancestors, depth + 1);
      }
      return;
    }

    const prototype: object | null = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain objects can be encoded.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Objects cannot contain symbol-keyed properties.");
    }
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value),
      keys: string[] = Object.keys(descriptors);
    if (keys.length > maximumCollectionLength) {
      throw new RangeError("Object exceeds the maximum collection length.");
    }
    for (const key of keys) {
      assertSafeObjectKey(key);
      const descriptor: PropertyDescriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("Objects may only contain enumerable data properties.");
      }
    }
    keys.sort();
    schemas.set(schemaId(keys), keys);
    for (const key of keys) {
      collectObjectSchemas(descriptors[key]!.value, schemas, ancestors, depth + 1);
    }
  } finally {
    ancestors.delete(value);
  }
}

function writeValue(
  writer: BinaryWriter,
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
  schemaIndices: ReadonlyMap<string, number> | null = null,
): void {
  if (depth > maximumNestingDepth) {
    throw new RangeError("Binary value is nested too deeply.");
  }

  if (value === null) {
    writer.writeByte(0xc0);
    return;
  }
  if (typeof value === "boolean") {
    writer.writeByte(value ? 0xc3 : 0xc2);
    return;
  }
  if (typeof value === "number") {
    writeNumber(writer, value);
    return;
  }
  if (typeof value === "string") {
    writeString(writer, value);
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Unsupported binary value type: ${typeof value}.`);
  }
  if (value instanceof Uint8Array) {
    writeBinary(writer, value);
    return;
  }

  if (ancestors.has(value)) {
    throw new TypeError("Cyclic values cannot be encoded.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError("Only plain arrays can be encoded.");
      }
      if (value.length > maximumCollectionLength) {
        throw new RangeError("Array exceeds the maximum collection length.");
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError("Arrays cannot contain symbol-keyed properties.");
      }

      const descriptors: Record<string, PropertyDescriptor> =
        Object.getOwnPropertyDescriptors(value);
      if (Object.keys(descriptors).length !== value.length + 1) {
        throw new TypeError("Arrays must be dense and cannot have extra properties.");
      }
      for (let index = 0; index < value.length; index++) {
        const descriptor: PropertyDescriptor | undefined = descriptors[String(index)]!;
        if (descriptor == null || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("Arrays must contain enumerable data elements at every index.");
        }
      }

      writeArrayHeader(writer, value.length);
      for (let index = 0; index < value.length; index++) {
        writeValue(writer, descriptors[String(index)]!.value, ancestors, depth + 1, schemaIndices);
      }
      return;
    }

    const prototype: object | null = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain objects can be encoded.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Objects cannot contain symbol-keyed properties.");
    }

    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value),
      keys: string[] = Object.keys(descriptors);
    if (keys.length > maximumCollectionLength) {
      throw new RangeError("Object exceeds the maximum collection length.");
    }
    for (const key of keys) {
      assertSafeObjectKey(key);
      const descriptor: PropertyDescriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("Objects may only contain enumerable data properties.");
      }
    }

    keys.sort();
    if (schemaIndices == null) {
      writeMapHeader(writer, keys.length);
      for (const key of keys) {
        writeString(writer, key);
        writeValue(writer, descriptors[key]!.value, ancestors, depth + 1, null);
      }
    } else {
      const index: number | undefined = schemaIndices.get(schemaId(keys));
      if (index === undefined) {
        throw new Error("Missing binary object schema.");
      }
      writer.writeByte(0xc1);
      writeNumber(writer, index);
      for (const key of keys) {
        writeValue(writer, descriptors[key]!.value, ancestors, depth + 1, schemaIndices);
      }
    }
  } finally {
    ancestors.delete(value);
  }
}

class BinaryReader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  public constructor(_bytes: Uint8Array) {
    this.#bytes = _bytes;
    this.#view = new DataView(_bytes.buffer, _bytes.byteOffset, _bytes.byteLength);
  }

  #require(length: number): void {
    if (length > this.#bytes.length - this.#offset) {
      throw new Error("Truncated binary value.");
    }
  }

  #readByte(): number {
    this.#require(1);
    return this.#bytes[this.#offset++]!;
  }

  #readUint16(): number {
    this.#require(2);
    const value: number = this.#view.getUint16(this.#offset);
    this.#offset += 2;
    return value;
  }

  #readUint32(): number {
    this.#require(4);
    const value: number = this.#view.getUint32(this.#offset);
    this.#offset += 4;
    return value;
  }

  #readBigUint64(): bigint {
    this.#require(8);
    const value: bigint = this.#view.getBigUint64(this.#offset);
    this.#offset += 8;
    return value;
  }

  #readFloat64(): number {
    this.#require(8);
    const value: number = this.#view.getFloat64(this.#offset);
    this.#offset += 8;
    if (!Number.isFinite(value)) {
      throw new Error("Binary numbers must be finite.");
    }
    return value;
  }

  #readSafeUint64(): number {
    const value: bigint = this.#readBigUint64();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Binary integer exceeds the safe numeric range.");
    }
    return Number(value);
  }

  #readSafeInt64(): number {
    const unsignedValue: bigint = this.#readBigUint64(),
      value: bigint = BigInt.asIntN(64, unsignedValue);
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Binary integer exceeds the safe numeric range.");
    }
    return Number(value);
  }

  #readString(length: number): string {
    if (length > maximumStringByteLength) {
      throw new RangeError("String exceeds the maximum encoded size.");
    }
    this.#require(length);
    const bytes: Uint8Array = this.#bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return decodeUtf8(bytes);
  }

  #readBinary(length: number): Uint8Array {
    if (length > maximumEncodedByteLength) {
      throw new RangeError("Binary value exceeds the maximum encoded size.");
    }
    this.#require(length);
    const bytes: Uint8Array = this.#bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return bytes;
  }

  #readStringValue(): string {
    const marker: number = this.#readByte();
    if ((marker & 0xe0) === 0xa0) {
      return this.#readString(marker & 0x1f);
    }
    switch (marker) {
      case 0xd9: {
        const length: number = this.#readByte();
        if (length <= 0x1f) {
          throw new Error("Non-canonical binary string length.");
        }
        return this.#readString(length);
      }
      case 0xda: {
        const length: number = this.#readUint16();
        if (length <= 0xff) {
          throw new Error("Non-canonical binary string length.");
        }
        return this.#readString(length);
      }
      case 0xdb: {
        const length: number = this.#readUint32();
        if (length <= 0xff_ff) {
          throw new Error("Non-canonical binary string length.");
        }
        return this.#readString(length);
      }
      default: {
        throw new Error("Binary object keys must be strings.");
      }
    }
  }

  #readCompactIndex(): number {
    const marker: number = this.#readByte();
    if (marker <= 0x7f) {
      return marker;
    }
    switch (marker) {
      case 0xcc: {
        const value: number = this.#readByte();
        if (value <= 0x7f) {
          throw new Error("Non-canonical binary schema index.");
        }
        return value;
      }
      case 0xcd: {
        const value: number = this.#readUint16();
        if (value <= 0xff) {
          throw new Error("Non-canonical binary schema index.");
        }
        return value;
      }
      case 0xce: {
        const value: number = this.#readUint32();
        if (value <= 0xff_ff) {
          throw new Error("Non-canonical binary schema index.");
        }
        return value;
      }
      default: {
        throw new Error("Invalid binary object schema index.");
      }
    }
  }

  #readSchemaObject(schemas: readonly ObjectSchema[], depth: number): Record<string, unknown> {
    const schemaIndex: number = this.#readCompactIndex();
    if (schemaIndex >= schemas.length) {
      throw new Error("Binary object schema index is out of range.");
    }
    const schema: ObjectSchema = schemas[schemaIndex]!;
    this.#require(schema.length);
    const result: Record<string, unknown> = {};
    for (const key of schema) {
      const value: unknown = this.#readValue(depth + 1, schemas);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
    return result;
  }

  #readArray(length: number, depth: number, schemas: readonly ObjectSchema[] | null): unknown[] {
    if (length > maximumCollectionLength) {
      throw new RangeError("Array exceeds the maximum collection length.");
    }
    // Every value needs at least one marker byte. Check that the declared
    // Length is possible before allocating or descending into nested arrays.
    this.#require(length);
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
      result.push(this.#readValue(depth + 1, schemas));
    }
    return result;
  }

  #readMap(
    length: number,
    depth: number,
    schemas: readonly ObjectSchema[] | null,
  ): Record<string, unknown> {
    if (length > maximumCollectionLength) {
      throw new RangeError("Object exceeds the maximum collection length.");
    }
    const result: Record<string, unknown> = {},
      keys = new Set<string>();
    let previousKey: string | null = null;
    for (let index = 0; index < length; index++) {
      const key: string = this.#readStringValue();
      assertSafeObjectKey(key);
      if (keys.has(key)) {
        throw new Error(`Duplicate binary object key: ${key}.`);
      }
      if (previousKey != null && key < previousKey) {
        throw new Error("Binary object keys are not in canonical order.");
      }
      keys.add(key);
      previousKey = key;
      const value: unknown = this.#readValue(depth + 1, schemas);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
    return result;
  }

  #readValue(depth: number, schemas: readonly ObjectSchema[] | null): unknown {
    if (depth > maximumNestingDepth) {
      throw new RangeError("Binary value is nested too deeply.");
    }

    const marker: number = this.#readByte();
    if (marker <= 0x7f) {
      return marker;
    }
    if (marker >= 0xe0) {
      return marker - 0x1_00;
    }
    if ((marker & 0xe0) === 0xa0) {
      return this.#readString(marker & 0x1f);
    }
    if ((marker & 0xf0) === 0x90) {
      return this.#readArray(marker & 0x0f, depth, schemas);
    }
    if ((marker & 0xf0) === 0x80) {
      return this.#readMap(marker & 0x0f, depth, schemas);
    }

    switch (marker) {
      case 0xc0: {
        return null;
      }
      case 0xc1: {
        if (schemas == null) {
          throw new Error("Unsupported MessagePack marker: 0xc1.");
        }
        return this.#readSchemaObject(schemas, depth);
      }
      case 0xc2: {
        return false;
      }
      case 0xc3: {
        return true;
      }
      case 0xc4: {
        return this.#readBinary(this.#readByte());
      }
      case 0xc5: {
        const length: number = this.#readUint16();
        if (length <= 0xff) {
          throw new Error("Non-canonical binary byte length.");
        }
        return this.#readBinary(length);
      }
      case 0xc6: {
        const length: number = this.#readUint32();
        if (length <= 0xff_ff) {
          throw new Error("Non-canonical binary byte length.");
        }
        return this.#readBinary(length);
      }
      case 0xca: {
        throw new Error("Unsupported MessagePack marker: 0xca.");
      }
      case 0xcb: {
        const value: number = this.#readFloat64();
        if (!Object.is(value, -0) && Number.isSafeInteger(value)) {
          throw new Error("Non-canonical binary number.");
        }
        return value;
      }
      case 0xcc: {
        const value: number = this.#readByte();
        if (value <= 0x7f) {
          throw new Error("Non-canonical binary integer.");
        }
        return value;
      }
      case 0xcd: {
        const value: number = this.#readUint16();
        if (value <= 0xff) {
          throw new Error("Non-canonical binary integer.");
        }
        return value;
      }
      case 0xce: {
        const value: number = this.#readUint32();
        if (value <= 0xff_ff) {
          throw new Error("Non-canonical binary integer.");
        }
        return value;
      }
      case 0xcf: {
        const value: number = this.#readSafeUint64();
        if (value <= 0xff_ff_ff_ff) {
          throw new Error("Non-canonical binary integer.");
        }
        return value;
      }
      case 0xd0: {
        const value: number = this.#readByte(),
          signedValue: number = value < 0x80 ? value : value - 0x1_00;
        if (signedValue >= -0x20) {
          throw new Error("Non-canonical binary integer.");
        }
        return signedValue;
      }
      case 0xd1: {
        const value: number = this.#readUint16(),
          signedValue: number = value < 0x80_00 ? value : value - 0x1_00_00;
        if (signedValue >= -0x80) {
          throw new Error("Non-canonical binary integer.");
        }
        return signedValue;
      }
      case 0xd2: {
        const value: number = this.#readUint32(),
          signedValue: number = value < 0x80_00_00_00 ? value : value - 0x1_00_00_00_00;
        if (signedValue >= -0x80_00) {
          throw new Error("Non-canonical binary integer.");
        }
        return signedValue;
      }
      case 0xd3: {
        const value: number = this.#readSafeInt64();
        if (value >= -0x80_00_00_00) {
          throw new Error("Non-canonical binary integer.");
        }
        return value;
      }
      case 0xd9: {
        const length: number = this.#readByte();
        if (length <= 0x1f) {
          throw new Error("Non-canonical binary string length.");
        }
        return this.#readString(length);
      }
      case 0xda: {
        const length: number = this.#readUint16();
        if (length <= 0xff) {
          throw new Error("Non-canonical binary string length.");
        }
        return this.#readString(length);
      }
      case 0xdb: {
        const length: number = this.#readUint32();
        if (length <= 0xff_ff) {
          throw new Error("Non-canonical binary string length.");
        }
        return this.#readString(length);
      }
      case 0xdc: {
        const length: number = this.#readUint16();
        if (length <= 0x0f) {
          throw new Error("Non-canonical binary array length.");
        }
        return this.#readArray(length, depth, schemas);
      }
      case 0xdd: {
        const length: number = this.#readUint32();
        if (length <= 0xff_ff) {
          throw new Error("Non-canonical binary array length.");
        }
        return this.#readArray(length, depth, schemas);
      }
      case 0xde: {
        const length: number = this.#readUint16();
        if (length <= 0x0f) {
          throw new Error("Non-canonical binary object length.");
        }
        return this.#readMap(length, depth, schemas);
      }
      case 0xdf: {
        const length: number = this.#readUint32();
        if (length <= 0xff_ff) {
          throw new Error("Non-canonical binary object length.");
        }
        return this.#readMap(length, depth, schemas);
      }
      default: {
        throw new Error(`Unsupported MessagePack marker: 0x${marker.toString(16)}.`);
      }
    }
  }

  public read(): unknown {
    let schemas: readonly ObjectSchema[] | null = null;
    if (this.#bytes[this.#offset] === 0xc1) {
      this.#offset++;
      const schemaCount: number = this.#readCompactIndex();
      if (schemaCount === 0 || schemaCount > maximumCollectionLength) {
        throw new Error("Invalid binary object schema table.");
      }
      const parsedSchemas: string[][] = [];
      let previousId: string | null = null;
      for (let schemaIndex = 0; schemaIndex < schemaCount; schemaIndex++) {
        const marker: number = this.#readByte();
        let keyCount: number;
        if ((marker & 0xf0) === 0x90) {
          keyCount = marker & 0x0f;
        } else if (marker === 0xdc) {
          keyCount = this.#readUint16();
          if (keyCount <= 0x0f) {
            throw new Error("Non-canonical binary schema length.");
          }
        } else if (marker === 0xdd) {
          keyCount = this.#readUint32();
          if (keyCount <= 0xff_ff) {
            throw new Error("Non-canonical binary schema length.");
          }
        } else {
          throw new Error("Invalid binary object schema table.");
        }
        if (keyCount > maximumCollectionLength) {
          throw new Error("Invalid binary object schema table.");
        }
        const keys: string[] = [];
        let previousKey: string | null = null;
        for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
          const key: string = this.#readStringValue();
          assertSafeObjectKey(key);
          if (previousKey != null && key <= previousKey) {
            throw new Error("Binary object schema keys are not canonical.");
          }
          keys.push(key);
          previousKey = key;
        }
        const id: string = schemaId(keys);
        if (previousId != null && id <= previousId) {
          throw new Error("Binary object schema table is not canonical.");
        }
        parsedSchemas.push(keys);
        previousId = id;
      }
      schemas = parsedSchemas;
    }
    const value: unknown = this.#readValue(0, schemas);
    if (this.#offset !== this.#bytes.length) {
      throw new Error("Binary value contains trailing data.");
    }
    return value;
  }
}

export function encodeBinaryValue(value: unknown, compactObjects = false): Uint8Array {
  const writer: BinaryWriter = new BinaryWriter();
  let schemaIndices: ReadonlyMap<string, number> | null = null;
  if (compactObjects) {
    const schemaMap = new Map<string, string[]>();
    collectObjectSchemas(value, schemaMap, new WeakSet(), 0);
    if (schemaMap.size > 0) {
      const schemas: [string, string[]][] = [...schemaMap.entries()].sort(
        ([left], [right]): number => (left < right ? -1 : left > right ? 1 : 0),
      );
      schemaIndices = new Map(schemas.map(([id], index: number): [string, number] => [id, index]));
      writer.writeByte(0xc1);
      writeNumber(writer, schemas.length);
      for (const [, keys] of schemas) {
        writeArrayHeader(writer, keys.length);
        for (const key of keys) {
          writeString(writer, key);
        }
      }
    }
  }
  writeValue(writer, value, new WeakSet(), 0, schemaIndices);
  return writer.finish();
}

export function decodeBinaryValue(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Binary value must be a Uint8Array.");
  }
  if (bytes.length > maximumEncodedByteLength) {
    throw new RangeError("Binary value exceeds the maximum encoded size.");
  }
  return new BinaryReader(bytes).read();
}
