// Hit timing uses musical position for sustains and wall time for the expanding copy.
export function noteWasHit(start: number, end: number, position: number, previous: number | null): boolean {
  if (previous == null) return start <= position && position < end;
  return previous < start && start <= position;
}

export function hitOpacity(timestamp: number, hitTime: number): number {
  return Math.max(0, 1 - (timestamp - hitTime) / 500);
}
