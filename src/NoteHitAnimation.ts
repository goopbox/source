// Hit timing uses musical position for sustains and wall time for the expanding copy.
const hitDuration: number = 250;

export function noteWasHit(start: number, end: number, position: number, previous: number | null): boolean {
  if (previous == null) return start <= position && position < end;
  return previous < start && start <= position;
}

export function hitIsActive(timestamp: number, hitTime: number): boolean {
  return timestamp - hitTime < hitDuration;
}

export function hitOpacity(timestamp: number, hitTime: number): number {
  return Math.max(0, 1 - (timestamp - hitTime) / hitDuration);
}
