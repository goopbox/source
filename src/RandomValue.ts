// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

export function selectCurvedValue(
  min: number,
  max: number,
  peak: number,
  width: number,
  step: number = 1,
  random: () => number = Math.random,
): number {
  const stepCount: number = Math.round((max - min) / step);
  let totalWeight: number = 0;
  for (let i: number = 0; i <= stepCount; i++) {
    const value: number = min + i * step;
    totalWeight += 1.0 / (Math.pow((value - peak) / width, 2.0) + 1.0);
  }

  let remainingWeight: number = random() * totalWeight;
  for (let i: number = 0; i <= stepCount; i++) {
    const value: number = min + i * step;
    remainingWeight -= 1.0 / (Math.pow((value - peak) / width, 2.0) + 1.0);
    if (remainingWeight <= 0.0) return value;
  }
  return max;
}
