// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

// This is a deliberately small, deterministic subset of MessagePack. It supports
// exactly the value types used by song data. Song encoding can optionally store each
// plain-object shape once, then encode objects positionally against those schemas.

const maximumNestingDepth: number = 100;
const maximumCollectionLength: number = 1_000_000;
const maximumStringByteLength: number = 16 * 1024 * 1024;
const maximumEncodedByteLength: number = 64 * 1024 * 1024;

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint: number = character.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
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
  let result: string = "";
  for (let index: number = 0; index < bytes.length;) {
    const first: number = bytes[index++]!;
    if (first <= 0x7f) {
      result += String.fromCodePoint(first);
      continue;
    }

    let continuationCount: number;
    let codePoint: number;
    let minimumCodePoint: number;
    if (first >= 0xc2 && first <= 0xdf) {
      continuationCount = 1;
      codePoint = first & 0x1f;
      minimumCodePoint = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      continuationCount = 2;
      codePoint = first & 0x0f;
      minimumCodePoint = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      continuationCount = 3;
      codePoint = first & 0x07;
      minimumCodePoint = 0x10000;
    } else {
      throw new Error("Binary string contains invalid UTF-8.");
    }

    if (index + continuationCount > bytes.length) {
      throw new Error("Binary string contains invalid UTF-8.");
    }
    for (
      let continuationIndex: number = 0;
      continuationIndex < continuationCount;
      continuationIndex++
    ) {
      const continuation: number = bytes[index++]!;
      if ((continuation & 0xc0) != 0x80) {
        throw new Error("Binary string contains invalid UTF-8.");
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    if (
      codePoint < minimumCodePoint ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      throw new Error("Binary string contains invalid UTF-8.");
    }
    result += String.fromCodePoint(codePoint);
  }
  return result;
}

const unsafeObjectKeys: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

class BinaryWriter {
  private _bytes: Uint8Array = new Uint8Array(1024);
  private _view: DataView = new DataView(this._bytes.buffer);
  private _length: number = 0;

  private _ensureCapacity(additionalLength: number): void {
    const requiredLength: number = this._length + additionalLength;
    if (requiredLength > maximumEncodedByteLength) {
      throw new RangeError("Binary value exceeds the maximum encoded size.");
    }

    if (requiredLength <= this._bytes.length) return;
    let newLength: number = this._bytes.length;
    while (newLength < requiredLength) {
      newLength = Math.min(maximumEncodedByteLength, newLength * 2);
    }
    const newBytes: Uint8Array = new Uint8Array(newLength);
    newBytes.set(this._bytes);
    this._bytes = newBytes;
    this._view = new DataView(newBytes.buffer);
  }

  public writeByte(value: number): void {
    this._ensureCapacity(1);
    this._bytes[this._length++] = value;
  }

  public writeUint16(value: number): void {
    this._ensureCapacity(2);
    this._view.setUint16(this._length, value);
    this._length += 2;
  }

  public writeUint32(value: number): void {
    this._ensureCapacity(4);
    this._view.setUint32(this._length, value);
    this._length += 4;
  }

  public writeBigUint64(value: bigint): void {
    this._ensureCapacity(8);
    this._view.setBigUint64(this._length, value);
    this._length += 8;
  }

  public writeFloat64(value: number): void {
    this._ensureCapacity(8);
    this._view.setFloat64(this._length, value);
    this._length += 8;
  }

  public writeBytes(value: Uint8Array): void {
    this._ensureCapacity(value.length);
    this._bytes.set(value, this._length);
    this._length += value.length;
  }

  public finish(): Uint8Array {
    return this._bytes.slice(0, this._length);
  }
}

function assertWellFormedString(value: string): void {
  if (value.length > maximumStringByteLength) {
    throw new RangeError("String exceeds the maximum encoded size.");
  }

  for (let index: number = 0; index < value.length; index++) {
    const codeUnit: number = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit: number = value.charCodeAt(++index);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
        throw new TypeError(
          "Strings must contain valid Unicode scalar values.",
        );
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
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
  } else if (bytes.length <= 0xffff) {
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
  } else if (value.length <= 0xffff) {
    writer.writeByte(0xc5);
    writer.writeUint16(value.length);
  } else {
    writer.writeByte(0xc6);
    writer.writeUint32(value.length);
  }
  writer.writeBytes(value);
}

function writeNumber(writer: BinaryWriter, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError("Numbers must be finite.");

  if (!Object.is(value, -0) && Number.isSafeInteger(value)) {
    if (value >= 0) {
      if (value <= 0x7f) {
        writer.writeByte(value);
      } else if (value <= 0xff) {
        writer.writeByte(0xcc);
        writer.writeByte(value);
      } else if (value <= 0xffff) {
        writer.writeByte(0xcd);
        writer.writeUint16(value);
      } else if (value <= 0xffffffff) {
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
    } else if (value >= -0x8000) {
      writer.writeByte(0xd1);
      writer.writeUint16(value & 0xffff);
    } else if (value >= -0x80000000) {
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
  } else if (length <= 0xffff) {
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
  } else if (length <= 0xffff) {
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
  if (depth > maximumNestingDepth)
    throw new RangeError("Binary value is nested too deeply.");
  if (
    value === null ||
    typeof value == "boolean" ||
    typeof value == "number" ||
    typeof value == "string"
  )
    return;
  if (typeof value != "object")
    throw new TypeError(`Unsupported binary value type: ${typeof value}.`);
  if (value instanceof Uint8Array) return;
  if (ancestors.has(value))
    throw new TypeError("Cyclic values cannot be encoded.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype)
        throw new TypeError("Only plain arrays can be encoded.");
      if (value.length > maximumCollectionLength)
        throw new RangeError("Array exceeds the maximum collection length.");
      if (Object.getOwnPropertySymbols(value).length != 0)
        throw new TypeError("Arrays cannot contain symbol-keyed properties.");
      const descriptors: Record<string, PropertyDescriptor> =
        Object.getOwnPropertyDescriptors(value);
      if (Object.keys(descriptors).length != value.length + 1)
        throw new TypeError(
          "Arrays must be dense and cannot have extra properties.",
        );
      for (let index: number = 0; index < value.length; index++) {
        const descriptor: PropertyDescriptor | undefined =
          descriptors[String(index)];
        if (
          descriptor == null ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        )
          throw new TypeError(
            "Arrays must contain enumerable data elements at every index.",
          );
        collectObjectSchemas(descriptor.value, schemas, ancestors, depth + 1);
      }
      return;
    }

    const prototype: object | null = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Only plain objects can be encoded.");
    if (Object.getOwnPropertySymbols(value).length != 0)
      throw new TypeError("Objects cannot contain symbol-keyed properties.");
    const descriptors: Record<string, PropertyDescriptor> =
      Object.getOwnPropertyDescriptors(value);
    const keys: string[] = Object.keys(descriptors);
    if (keys.length > maximumCollectionLength)
      throw new RangeError("Object exceeds the maximum collection length.");
    for (const key of keys) {
      assertSafeObjectKey(key);
      const descriptor: PropertyDescriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new TypeError(
          "Objects may only contain enumerable data properties.",
        );
    }
    keys.sort();
    schemas.set(schemaId(keys), keys);
    for (const key of keys)
      collectObjectSchemas(
        descriptors[key].value,
        schemas,
        ancestors,
        depth + 1,
      );
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
  if (depth > maximumNestingDepth)
    throw new RangeError("Binary value is nested too deeply.");

  if (value === null) {
    writer.writeByte(0xc0);
    return;
  }
  if (typeof value == "boolean") {
    writer.writeByte(value ? 0xc3 : 0xc2);
    return;
  }
  if (typeof value == "number") {
    writeNumber(writer, value);
    return;
  }
  if (typeof value == "string") {
    writeString(writer, value);
    return;
  }
  if (typeof value != "object") {
    throw new TypeError(`Unsupported binary value type: ${typeof value}.`);
  }
  if (value instanceof Uint8Array) {
    writeBinary(writer, value);
    return;
  }

  if (ancestors.has(value))
    throw new TypeError("Cyclic values cannot be encoded.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError("Only plain arrays can be encoded.");
      }
      if (value.length > maximumCollectionLength) {
        throw new RangeError("Array exceeds the maximum collection length.");
      }
      if (Object.getOwnPropertySymbols(value).length != 0) {
        throw new TypeError("Arrays cannot contain symbol-keyed properties.");
      }

      const descriptors: Record<string, PropertyDescriptor> =
        Object.getOwnPropertyDescriptors(value);
      if (Object.keys(descriptors).length != value.length + 1) {
        throw new TypeError(
          "Arrays must be dense and cannot have extra properties.",
        );
      }
      for (let index: number = 0; index < value.length; index++) {
        const descriptor: PropertyDescriptor | undefined =
          descriptors[String(index)];
        if (
          descriptor == null ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new TypeError(
            "Arrays must contain enumerable data elements at every index.",
          );
        }
      }

      writeArrayHeader(writer, value.length);
      for (let index: number = 0; index < value.length; index++) {
        writeValue(
          writer,
          descriptors[String(index)].value,
          ancestors,
          depth + 1,
          schemaIndices,
        );
      }
      return;
    }

    const prototype: object | null = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain objects can be encoded.");
    }
    if (Object.getOwnPropertySymbols(value).length != 0) {
      throw new TypeError("Objects cannot contain symbol-keyed properties.");
    }

    const descriptors: Record<string, PropertyDescriptor> =
      Object.getOwnPropertyDescriptors(value);
    const keys: string[] = Object.keys(descriptors);
    if (keys.length > maximumCollectionLength) {
      throw new RangeError("Object exceeds the maximum collection length.");
    }
    for (const key of keys) {
      assertSafeObjectKey(key);
      const descriptor: PropertyDescriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(
          "Objects may only contain enumerable data properties.",
        );
      }
    }

    keys.sort();
    if (schemaIndices == null) {
      writeMapHeader(writer, keys.length);
      for (const key of keys) {
        writeString(writer, key);
        writeValue(writer, descriptors[key].value, ancestors, depth + 1, null);
      }
    } else {
      const index: number | undefined = schemaIndices.get(schemaId(keys));
      if (index === undefined) throw new Error("Missing binary object schema.");
      writer.writeByte(0xc1);
      writeNumber(writer, index);
      for (const key of keys)
        writeValue(
          writer,
          descriptors[key].value,
          ancestors,
          depth + 1,
          schemaIndices,
        );
    }
  } finally {
    ancestors.delete(value);
  }
}

class BinaryReader {
  private readonly _view: DataView;
  private _offset: number = 0;

  public constructor(private readonly _bytes: Uint8Array) {
    this._view = new DataView(
      _bytes.buffer,
      _bytes.byteOffset,
      _bytes.byteLength,
    );
  }

  private _require(length: number): void {
    if (length > this._bytes.length - this._offset) {
      throw new Error("Truncated binary value.");
    }
  }

  private _readByte(): number {
    this._require(1);
    return this._bytes[this._offset++];
  }

  private _readUint16(): number {
    this._require(2);
    const value: number = this._view.getUint16(this._offset);
    this._offset += 2;
    return value;
  }

  private _readUint32(): number {
    this._require(4);
    const value: number = this._view.getUint32(this._offset);
    this._offset += 4;
    return value;
  }

  private _readBigUint64(): bigint {
    this._require(8);
    const value: bigint = this._view.getBigUint64(this._offset);
    this._offset += 8;
    return value;
  }

  private _readFloat64(): number {
    this._require(8);
    const value: number = this._view.getFloat64(this._offset);
    this._offset += 8;
    if (!Number.isFinite(value))
      throw new Error("Binary numbers must be finite.");
    return value;
  }

  private _readSafeUint64(): number {
    const value: bigint = this._readBigUint64();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Binary integer exceeds the safe numeric range.");
    }
    return Number(value);
  }

  private _readSafeInt64(): number {
    const unsignedValue: bigint = this._readBigUint64();
    const value: bigint = BigInt.asIntN(64, unsignedValue);
    if (
      value < BigInt(Number.MIN_SAFE_INTEGER) ||
      value > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error("Binary integer exceeds the safe numeric range.");
    }
    return Number(value);
  }

  private _readString(length: number): string {
    if (length > maximumStringByteLength) {
      throw new RangeError("String exceeds the maximum encoded size.");
    }
    this._require(length);
    const bytes: Uint8Array = this._bytes.subarray(
      this._offset,
      this._offset + length,
    );
    this._offset += length;
    return decodeUtf8(bytes);
  }

  private _readBinary(length: number): Uint8Array {
    if (length > maximumEncodedByteLength)
      throw new RangeError("Binary value exceeds the maximum encoded size.");
    this._require(length);
    const bytes: Uint8Array = this._bytes.slice(
      this._offset,
      this._offset + length,
    );
    this._offset += length;
    return bytes;
  }

  private _readStringValue(): string {
    const marker: number = this._readByte();
    if ((marker & 0xe0) == 0xa0) return this._readString(marker & 0x1f);
    switch (marker) {
      case 0xd9: {
        const length: number = this._readByte();
        if (length <= 0x1f)
          throw new Error("Non-canonical binary string length.");
        return this._readString(length);
      }
      case 0xda: {
        const length: number = this._readUint16();
        if (length <= 0xff)
          throw new Error("Non-canonical binary string length.");
        return this._readString(length);
      }
      case 0xdb: {
        const length: number = this._readUint32();
        if (length <= 0xffff)
          throw new Error("Non-canonical binary string length.");
        return this._readString(length);
      }
      default:
        throw new Error("Binary object keys must be strings.");
    }
  }

  private _readCompactIndex(): number {
    const marker: number = this._readByte();
    if (marker <= 0x7f) return marker;
    switch (marker) {
      case 0xcc: {
        const value: number = this._readByte();
        if (value <= 0x7f)
          throw new Error("Non-canonical binary schema index.");
        return value;
      }
      case 0xcd: {
        const value: number = this._readUint16();
        if (value <= 0xff)
          throw new Error("Non-canonical binary schema index.");
        return value;
      }
      case 0xce: {
        const value: number = this._readUint32();
        if (value <= 0xffff)
          throw new Error("Non-canonical binary schema index.");
        return value;
      }
      default:
        throw new Error("Invalid binary object schema index.");
    }
  }

  private _readSchemaObject(
    schemas: readonly ObjectSchema[],
    depth: number,
  ): Record<string, unknown> {
    const schemaIndex: number = this._readCompactIndex();
    if (schemaIndex >= schemas.length)
      throw new Error("Binary object schema index is out of range.");
    const schema: ObjectSchema = schemas[schemaIndex];
    this._require(schema.length);
    const result: Record<string, unknown> = {};
    for (const key of schema) {
      const value: unknown = this._readValue(depth + 1, schemas);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
    return result;
  }

  private _readArray(
    length: number,
    depth: number,
    schemas: readonly ObjectSchema[] | null,
  ): unknown[] {
    if (length > maximumCollectionLength) {
      throw new RangeError("Array exceeds the maximum collection length.");
    }
    // Every value needs at least one marker byte. Check that the declared
    // length is possible before allocating or descending into nested arrays.
    this._require(length);
    const result: unknown[] = [];
    for (let index: number = 0; index < length; index++) {
      result.push(this._readValue(depth + 1, schemas));
    }
    return result;
  }

  private _readMap(
    length: number,
    depth: number,
    schemas: readonly ObjectSchema[] | null,
  ): Record<string, unknown> {
    if (length > maximumCollectionLength) {
      throw new RangeError("Object exceeds the maximum collection length.");
    }
    const result: Record<string, unknown> = {};
    const keys: Set<string> = new Set();
    let previousKey: string | null = null;
    for (let index: number = 0; index < length; index++) {
      const key: string = this._readStringValue();
      assertSafeObjectKey(key);
      if (keys.has(key))
        throw new Error(`Duplicate binary object key: ${key}.`);
      if (previousKey != null && key < previousKey)
        throw new Error("Binary object keys are not in canonical order.");
      keys.add(key);
      previousKey = key;
      const value: unknown = this._readValue(depth + 1, schemas);
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
    return result;
  }

  private _readValue(
    depth: number,
    schemas: readonly ObjectSchema[] | null,
  ): unknown {
    if (depth > maximumNestingDepth)
      throw new RangeError("Binary value is nested too deeply.");

    const marker: number = this._readByte();
    if (marker <= 0x7f) return marker;
    if (marker >= 0xe0) return marker - 0x100;
    if ((marker & 0xe0) == 0xa0) return this._readString(marker & 0x1f);
    if ((marker & 0xf0) == 0x90)
      return this._readArray(marker & 0x0f, depth, schemas);
    if ((marker & 0xf0) == 0x80)
      return this._readMap(marker & 0x0f, depth, schemas);

    switch (marker) {
      case 0xc0:
        return null;
      case 0xc1: {
        if (schemas == null)
          throw new Error("Unsupported MessagePack marker: 0xc1.");
        return this._readSchemaObject(schemas, depth);
      }
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return this._readBinary(this._readByte());
      case 0xc5: {
        const length: number = this._readUint16();
        if (length <= 0xff)
          throw new Error("Non-canonical binary byte length.");
        return this._readBinary(length);
      }
      case 0xc6: {
        const length: number = this._readUint32();
        if (length <= 0xffff)
          throw new Error("Non-canonical binary byte length.");
        return this._readBinary(length);
      }
      case 0xca:
        throw new Error("Unsupported MessagePack marker: 0xca.");
      case 0xcb: {
        const value: number = this._readFloat64();
        if (!Object.is(value, -0) && Number.isSafeInteger(value))
          throw new Error("Non-canonical binary number.");
        return value;
      }
      case 0xcc: {
        const value: number = this._readByte();
        if (value <= 0x7f) throw new Error("Non-canonical binary integer.");
        return value;
      }
      case 0xcd: {
        const value: number = this._readUint16();
        if (value <= 0xff) throw new Error("Non-canonical binary integer.");
        return value;
      }
      case 0xce: {
        const value: number = this._readUint32();
        if (value <= 0xffff) throw new Error("Non-canonical binary integer.");
        return value;
      }
      case 0xcf: {
        const value: number = this._readSafeUint64();
        if (value <= 0xffffffff)
          throw new Error("Non-canonical binary integer.");
        return value;
      }
      case 0xd0: {
        const value: number = this._readByte();
        const signedValue: number = value < 0x80 ? value : value - 0x100;
        if (signedValue >= -0x20)
          throw new Error("Non-canonical binary integer.");
        return signedValue;
      }
      case 0xd1: {
        const value: number = this._readUint16();
        const signedValue: number = value < 0x8000 ? value : value - 0x10000;
        if (signedValue >= -0x80)
          throw new Error("Non-canonical binary integer.");
        return signedValue;
      }
      case 0xd2: {
        const value: number = this._readUint32();
        const signedValue: number =
          value < 0x80000000 ? value : value - 0x100000000;
        if (signedValue >= -0x8000)
          throw new Error("Non-canonical binary integer.");
        return signedValue;
      }
      case 0xd3: {
        const value: number = this._readSafeInt64();
        if (value >= -0x80000000)
          throw new Error("Non-canonical binary integer.");
        return value;
      }
      case 0xd9: {
        const length: number = this._readByte();
        if (length <= 0x1f)
          throw new Error("Non-canonical binary string length.");
        return this._readString(length);
      }
      case 0xda: {
        const length: number = this._readUint16();
        if (length <= 0xff)
          throw new Error("Non-canonical binary string length.");
        return this._readString(length);
      }
      case 0xdb: {
        const length: number = this._readUint32();
        if (length <= 0xffff)
          throw new Error("Non-canonical binary string length.");
        return this._readString(length);
      }
      case 0xdc: {
        const length: number = this._readUint16();
        if (length <= 0x0f)
          throw new Error("Non-canonical binary array length.");
        return this._readArray(length, depth, schemas);
      }
      case 0xdd: {
        const length: number = this._readUint32();
        if (length <= 0xffff)
          throw new Error("Non-canonical binary array length.");
        return this._readArray(length, depth, schemas);
      }
      case 0xde: {
        const length: number = this._readUint16();
        if (length <= 0x0f)
          throw new Error("Non-canonical binary object length.");
        return this._readMap(length, depth, schemas);
      }
      case 0xdf: {
        const length: number = this._readUint32();
        if (length <= 0xffff)
          throw new Error("Non-canonical binary object length.");
        return this._readMap(length, depth, schemas);
      }
      default:
        throw new Error(
          `Unsupported MessagePack marker: 0x${marker.toString(16)}.`,
        );
    }
  }

  public read(): unknown {
    let schemas: readonly ObjectSchema[] | null = null;
    if (this._bytes[this._offset] == 0xc1) {
      this._offset++;
      const schemaCount: number = this._readCompactIndex();
      if (schemaCount == 0 || schemaCount > maximumCollectionLength)
        throw new Error("Invalid binary object schema table.");
      const parsedSchemas: string[][] = [];
      let previousId: string | null = null;
      for (
        let schemaIndex: number = 0;
        schemaIndex < schemaCount;
        schemaIndex++
      ) {
        const marker: number = this._readByte();
        let keyCount: number;
        if ((marker & 0xf0) == 0x90) {
          keyCount = marker & 0x0f;
        } else if (marker == 0xdc) {
          keyCount = this._readUint16();
          if (keyCount <= 0x0f)
            throw new Error("Non-canonical binary schema length.");
        } else if (marker == 0xdd) {
          keyCount = this._readUint32();
          if (keyCount <= 0xffff)
            throw new Error("Non-canonical binary schema length.");
        } else {
          throw new Error("Invalid binary object schema table.");
        }
        if (keyCount > maximumCollectionLength)
          throw new Error("Invalid binary object schema table.");
        const keys: string[] = [];
        let previousKey: string | null = null;
        for (let keyIndex: number = 0; keyIndex < keyCount; keyIndex++) {
          const key: string = this._readStringValue();
          assertSafeObjectKey(key);
          if (previousKey != null && key <= previousKey)
            throw new Error("Binary object schema keys are not canonical.");
          keys.push(key);
          previousKey = key;
        }
        const id: string = schemaId(keys);
        if (previousId != null && id <= previousId)
          throw new Error("Binary object schema table is not canonical.");
        parsedSchemas.push(keys);
        previousId = id;
      }
      schemas = parsedSchemas;
    }
    const value: unknown = this._readValue(0, schemas);
    if (this._offset != this._bytes.length)
      throw new Error("Binary value contains trailing data.");
    return value;
  }
}

export function encodeBinaryValue(
  value: unknown,
  compactObjects: boolean = false,
): Uint8Array {
  const writer: BinaryWriter = new BinaryWriter();
  let schemaIndices: ReadonlyMap<string, number> | null = null;
  if (compactObjects) {
    const schemaMap: Map<string, string[]> = new Map();
    collectObjectSchemas(value, schemaMap, new WeakSet(), 0);
    if (schemaMap.size > 0) {
      const schemas: Array<[string, string[]]> = Array.from(
        schemaMap.entries(),
      ).sort(([left], [right]): number =>
        left < right ? -1 : left > right ? 1 : 0,
      );
      schemaIndices = new Map(
        schemas.map(([id], index: number): [string, number] => [id, index]),
      );
      writer.writeByte(0xc1);
      writeNumber(writer, schemas.length);
      for (const [, keys] of schemas) {
        writeArrayHeader(writer, keys.length);
        for (const key of keys) writeString(writer, key);
      }
    }
  }
  writeValue(writer, value, new WeakSet(), 0, schemaIndices);
  return writer.finish();
}

export function decodeBinaryValue(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("Binary value must be a Uint8Array.");
  if (bytes.length > maximumEncodedByteLength) {
    throw new RangeError("Binary value exceeds the maximum encoded size.");
  }
  return new BinaryReader(bytes).read();
}
