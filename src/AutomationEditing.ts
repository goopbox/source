// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config, type AutomationValueDomain } from "../synth/SynthConfig.js";
import {
  AutomationEvent,
  AutomationPoint,
  sanitizeAutomationValue,
} from "../synth/synth.js";

export function clipAutomationEvent(
  event: AutomationEvent,
  start: number,
  end: number,
): AutomationEvent | null {
  const clippedStart: number = Math.max(event.start, start);
  const clippedEnd: number = Math.min(event.end, end);
  if (clippedStart >= clippedEnd) return null;
  const points: AutomationPoint[] = [
    new AutomationPoint(0, event.getValueAt(clippedStart)),
  ];
  for (const point of event.points) {
    const absoluteTime: number = event.start + point.time;
    if (absoluteTime <= clippedStart || absoluteTime >= clippedEnd) continue;
    points.push(new AutomationPoint(absoluteTime - clippedStart, point.value));
  }
  points.push(
    new AutomationPoint(
      clippedEnd - clippedStart,
      event.getValueAt(clippedEnd),
    ),
  );
  return new AutomationEvent(clippedStart, clippedEnd, points);
}

export function deleteAutomationRange(
  events: readonly AutomationEvent[],
  start: number,
  end: number,
): AutomationEvent[] {
  const replacement: AutomationEvent[] = [];
  for (const event of events) {
    if (event.end <= start || event.start >= end) {
      replacement.push(event.clone());
      continue;
    }
    const before: AutomationEvent | null = clipAutomationEvent(
      event,
      event.start,
      start,
    );
    const after: AutomationEvent | null = clipAutomationEvent(
      event,
      end,
      event.end,
    );
    if (before != null) replacement.push(before);
    if (after != null) replacement.push(after);
  }
  return replacement;
}

export function bendAutomationEvent(
  event: AutomationEvent,
  absolutePart: number,
  valueDelta: number,
  domain: AutomationValueDomain,
  uniform: boolean,
): AutomationEvent {
  const replacement: AutomationEvent = event.clone();
  const time: number = Math.max(
    0,
    Math.min(event.end - event.start, absolutePart - event.start),
  );
  const value: number = sanitizeAutomationValue(
    event.getValueAt(event.start + time) + valueDelta,
    domain,
  );
  if (uniform) {
    for (const point of replacement.points) point.value = value;
    return replacement;
  }
  const existing: AutomationPoint | undefined = replacement.points.find(
    (point: AutomationPoint): boolean => Math.abs(point.time - time) < 0.0001,
  );
  if (existing != undefined) {
    existing.value = value;
  } else if (replacement.points.length < Config.automationPointsPerEventMax) {
    replacement.points.push(new AutomationPoint(time, value));
    replacement.points.sort(
      (a: AutomationPoint, b: AutomationPoint): number => a.time - b.time,
    );
  }
  return replacement;
}
