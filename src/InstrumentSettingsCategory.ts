// Distributed under the Unlicense.

export type InstrumentSettingsCategory = "specific" | "effects" | "envelopes";

export interface InstrumentSettingsCategoryCopy {
  readonly category: InstrumentSettingsCategory;
  readonly settings: Record<string, unknown>;
}

const effectProperties: ReadonlySet<string> = new Set([
  "effects",
  "eqFilter",
  "transition",
  "chord",
  "pitchShiftSemitones",
  "detuneCents",
  "vibrato",
  "unison",
  "noteFilter",
  "distortion",
  "bitcrusherOctave",
  "bitcrusherQuantization",
  "chorus",
  "echoSustain",
  "echoDelayBeats",
  "reverb",
]);

const generalProperties: ReadonlySet<string> = new Set([
  "volume",
  "pan",
  "fadeInSeconds",
  "fadeOutTicks",
  "preset",
]);

function propertyIsInCategory(
  property: string,
  category: InstrumentSettingsCategory,
): boolean {
  if (category == "effects") return effectProperties.has(property);
  if (category == "envelopes") return property == "envelopes";
  return (
    !effectProperties.has(property) &&
    property != "envelopes" &&
    !generalProperties.has(property)
  );
}

export function copyInstrumentSettingsCategory(
  instrument: Record<string, unknown>,
  category: InstrumentSettingsCategory,
): InstrumentSettingsCategoryCopy {
  const settings: Record<string, unknown> = {};
  for (const [property, value] of Object.entries(instrument)) {
    if (propertyIsInCategory(property, category)) {
      settings[property] = structuredClone(value);
    }
  }
  return { category, settings };
}

export function pasteInstrumentSettingsCategory(
  instrument: Record<string, unknown>,
  copy: InstrumentSettingsCategoryCopy,
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(instrument);
  for (const property of Object.keys(result)) {
    if (propertyIsInCategory(property, copy.category)) delete result[property];
  }
  for (const [property, value] of Object.entries(copy.settings)) {
    if (propertyIsInCategory(property, copy.category)) {
      result[property] = structuredClone(value);
    }
  }
  return result;
}

export function isInstrumentSettingsCategoryCopy(
  value: unknown,
  category: InstrumentSettingsCategory,
): value is InstrumentSettingsCategoryCopy {
  if (value == null || typeof value != "object") return false;
  const candidate = value as Partial<InstrumentSettingsCategoryCopy>;
  return (
    candidate.category == category &&
    candidate.settings != null &&
    typeof candidate.settings == "object" &&
    !Array.isArray(candidate.settings)
  );
}
