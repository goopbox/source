// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Event, EventPoint } from "../synth/synth.js";
import { prettyNumber } from "./EditorConfig.js";

export interface EventRange {
  readonly start: number;
  readonly end: number;
}

export interface EventPathOptions {
  readonly partWidth: number;
  readonly radius: number;
  readonly centerY: (point: EventPoint) => number;
  readonly valueScale: (point: EventPoint) => number;
  readonly pitchInterval?: (point: EventPoint) => number;
}

export function cloneEvents<T extends Event>(events: readonly T[]): T[] {
  return events.map((event: T): T => event.clone());
}

export function clipEvent<T extends Event>(
  event: T,
  start: number,
  end: number,
): T | null {
  const clippedStart: number = Math.max(event.start, start);
  const clippedEnd: number = Math.min(event.end, end);
  if (clippedStart >= clippedEnd) return null;

  const first: EventPoint = event.getPointAt(clippedStart);
  first.time = 0;
  const points: EventPoint[] = [first];
  for (const point of event.points) {
    const absoluteTime: number = event.start + point.time;
    if (absoluteTime <= clippedStart || absoluteTime >= clippedEnd) continue;
    const copy: EventPoint = point.clone();
    copy.time = absoluteTime - clippedStart;
    points.push(copy);
  }
  const last: EventPoint = event.getPointAt(clippedEnd);
  last.time = clippedEnd - clippedStart;
  points.push(last);
  return event.cloneWith(clippedStart, clippedEnd, points);
}

export function deleteEventRange<T extends Event>(
  events: readonly T[],
  start: number,
  end: number,
): T[] {
  const replacement: T[] = [];
  for (const event of events) {
    if (event.end <= start || event.start >= end) {
      replacement.push(event.clone());
      continue;
    }
    const before: T | null = clipEvent(event, event.start, start);
    const after: T | null = clipEvent(event, end, event.end);
    if (before != null) replacement.push(before);
    if (after != null) replacement.push(after);
  }
  return replacement;
}

export function resizeEventStart<T extends Event>(
  event: T,
  start: number,
  pointCountMax: number,
): T {
  if (start >= event.start) {
    return clipEvent(event, start, event.end) ?? event.clone();
  }
  const offset: number = event.start - start;
  const points: EventPoint[] = [];
  if (event.points.length < pointCountMax) {
    const first: EventPoint = event.points[0].clone();
    first.time = 0;
    points.push(first);
  }
  for (const point of event.points) {
    const copy: EventPoint = point.clone();
    copy.time = points.length == 0 ? 0 : point.time + offset;
    points.push(copy);
  }
  return event.cloneWith(start, event.end, points);
}

export function resizeEventEnd<T extends Event>(
  event: T,
  end: number,
  pointCountMax: number,
): T {
  if (end <= event.end) {
    return clipEvent(event, event.start, end) ?? event.clone();
  }
  const points: EventPoint[] = event.points.map(
    (point: EventPoint): EventPoint => point.clone(),
  );
  const last: EventPoint = points[points.length - 1];
  if (points.length < pointCountMax) {
    const extended: EventPoint = last.clone();
    extended.time = end - event.start;
    points.push(extended);
  } else {
    last.time = end - event.start;
  }
  return event.cloneWith(event.start, end, points);
}

export function editEventTime<T extends Event>(
  events: readonly T[],
  eventIndex: number,
  pointIndex: number,
  delta: number,
  minDuration: number,
  maximumEnd: number,
  pointCountMax: number,
): T[] {
  const original: T | undefined = events[eventIndex];
  if (original == undefined) return cloneEvents(events);
  const lastPointIndex: number = original.points.length - 1;
  if (pointIndex != 0 && pointIndex != lastPointIndex) {
    const replacement: T[] = cloneEvents(events);
    const originalTime: number = original.points[pointIndex].time;
    const shiftedTime: number = Math.max(
      0,
      Math.min(original.end - original.start, originalTime + delta),
    );
    const skipStart: number = Math.min(originalTime, shiftedTime);
    const skipEnd: number = Math.max(originalTime, shiftedTime);
    const shiftedPoint: EventPoint = original.points[pointIndex].clone();
    shiftedPoint.time = shiftedTime;
    replacement[eventIndex].points = original.points
      .filter(
        (point: EventPoint): boolean =>
          point.time < skipStart || point.time > skipEnd,
      )
      .map((point: EventPoint): EventPoint => point.clone())
      .concat(shiftedPoint)
      .sort((a: EventPoint, b: EventPoint): number => a.time - b.time);
    return replacement;
  }

  const shiftedEndpoint: number =
    (pointIndex == 0 ? original.start : original.end) + delta;
  const others: T[] = events
    .filter((_event: T, index: number): boolean => index != eventIndex)
    .map((event: T): T => event.clone());
  if (
    (pointIndex == 0 && shiftedEndpoint >= original.end) ||
    (pointIndex != 0 && shiftedEndpoint <= original.start)
  ) return others;

  const held: T = pointIndex == 0
    ? resizeEventStart(
        original,
        Math.max(0, Math.min(original.end - minDuration, original.start + delta)),
        pointCountMax,
      )
    : resizeEventEnd(
        original,
        Math.max(
          original.start + minDuration,
          Math.min(maximumEnd, original.end + delta),
        ),
        pointCountMax,
      );
  return deleteEventRange(others, held.start, held.end)
    .concat(held)
    .sort((a: T, b: T): number => a.start - b.start);
}

export function nearestEventPointIndex(
  event: Event,
  absolutePart: number,
  endpointRadius: number = 0,
): number {
  const lastPointIndex: number = event.points.length - 1;
  if (lastPointIndex <= 0) return Math.max(0, lastPointIndex);
  const eventTime: number = absolutePart - event.start;
  if (Math.abs(eventTime - event.points[0].time) <= endpointRadius) return 0;
  if (
    Math.abs(eventTime - event.points[lastPointIndex].time) <= endpointRadius
  ) return lastPointIndex;
  let nearestIndex: number = 0;
  let nearestDistance: number = Number.POSITIVE_INFINITY;
  for (let index: number = 0; index < event.points.length; index++) {
    const distance: number = Math.abs(event.points[index].time - eventTime);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

export function bendEvent<T extends Event>(
  event: T,
  absolutePart: number,
  valueDelta: number,
  sanitize: (value: number) => number,
  uniform: boolean,
  pointCountMax: number,
): T {
  const replacement: T = event.clone();
  const time: number = Math.max(
    0,
    Math.min(event.end - event.start, absolutePart - event.start),
  );
  const value: number = sanitize(
    event.getValueAt(event.start + time) + valueDelta,
  );
  if (uniform) {
    for (const point of replacement.points) point.value = value;
    return replacement;
  }
  const existing: EventPoint | undefined = replacement.points.find(
    (point: EventPoint): boolean => Math.abs(point.time - time) < 0.0001,
  );
  if (existing != undefined) {
    existing.value = value;
  } else if (replacement.points.length < pointCountMax) {
    const point: EventPoint = event.getPointAt(event.start + time);
    point.time = time;
    point.value = value;
    replacement.points.push(point);
    replacement.points.sort(
      (a: EventPoint, b: EventPoint): number => a.time - b.time,
    );
  }
  return replacement;
}

export function moveEventRange<T extends Event>(
  events: readonly T[],
  range: EventRange,
  delta: number,
): T[] {
  const moved: T[] = [];
  for (const event of events) {
    const selected: T | null = clipEvent(event, range.start, range.end);
    if (selected == null) continue;
    selected.start += delta;
    selected.end += delta;
    moved.push(selected);
  }
  const newStart: number = range.start + delta;
  const newEnd: number = range.end + delta;
  return deleteEventRange(
    deleteEventRange(events, range.start, range.end),
    newStart,
    newEnd,
  ).concat(moved).sort((a: T, b: T): number => a.start - b.start);
}

export function repeatEvents<T extends Event>(
  events: readonly T[],
  sourceDuration: number,
  destination: EventRange,
): T[] {
  if (sourceDuration <= 0 || destination.start >= destination.end) return [];
  const repeated: T[] = [];
  for (
    let offset: number = destination.start;
    offset < destination.end;
    offset += sourceDuration
  ) {
    for (const source of events) {
      const shifted: T = source.clone();
      shifted.start += offset;
      shifted.end += offset;
      const clipped: T | null = clipEvent(
        shifted,
        destination.start,
        destination.end,
      );
      if (clipped != null) repeated.push(clipped);
    }
  }
  return repeated;
}

export function eventPath(event: Event, options: EventPathOptions): string {
  if (event.points.length == 0) return "";
  const points: EventPoint[] = event.points.map(
    (point: EventPoint): EventPoint => point.clone(),
  );
  const duration: number = event.end - event.start;
  const last: EventPoint = points[points.length - 1];
  if (last.time < duration) {
    const endPoint: EventPoint = event.getPointAt(event.end);
    endPoint.time = duration;
    points.push(endPoint);
  }
  const totalWidth: number = options.partWidth * duration;
  const endOffset: number = 0.5 * Math.max(0, Math.min(2, totalWidth - 1));
  const position = (
    point: EventPoint,
    index: number,
  ): { x: number; center: number; size: number; interval: number } => ({
    x:
      options.partWidth * (event.start + point.time) +
      (index == 0 ? endOffset : index == points.length - 1 ? -endOffset : 0),
    center: options.centerY(point),
    size: options.radius * options.valueScale(point),
    interval: options.pitchInterval?.(point) ?? 0,
  });
  const first = position(points[0], 0);
  let path: string = `M ${prettyNumber(first.x)} ${prettyNumber(first.center + first.size)} `;
  for (let index: number = 1; index < points.length; index++) {
    const previous = position(points[index - 1], index - 1);
    const next = position(points[index], index);
    path += `L ${prettyNumber(previous.x)} ${prettyNumber(previous.center - previous.size)} `;
    if (options.pitchInterval != undefined) {
      if (previous.interval > next.interval) {
        path += `L ${prettyNumber(previous.x + 1)} ${prettyNumber(previous.center - previous.size)} `;
      } else if (previous.interval < next.interval) {
        path += `L ${prettyNumber(next.x - 1)} ${prettyNumber(next.center - next.size)} `;
      }
    }
    path += `L ${prettyNumber(next.x)} ${prettyNumber(next.center - next.size)} `;
  }
  for (let index: number = points.length - 2; index >= 0; index--) {
    const previous = position(points[index + 1], index + 1);
    const next = position(points[index], index);
    path += `L ${prettyNumber(previous.x)} ${prettyNumber(previous.center + previous.size)} `;
    if (options.pitchInterval != undefined) {
      if (previous.interval < next.interval) {
        path += `L ${prettyNumber(previous.x - 1)} ${prettyNumber(previous.center + previous.size)} `;
      } else if (previous.interval > next.interval) {
        path += `L ${prettyNumber(next.x + 1)} ${prettyNumber(next.center + next.size)} `;
      }
    }
    path += `L ${prettyNumber(next.x)} ${prettyNumber(next.center + next.size)} `;
  }
  return path + "z";
}
