// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

// Interface shared by number[], Float32Array, and other typed arrays in JavaScript.
interface NumberArray {
  length: number;
  [index: number]: number;
}

// A basic FFT operation scales the overall magnitude of elements by the
// Square root of the length of the array, √N. Performing a forward FFT and
// Then an inverse FFT results in the original array, but multiplied by N.
// This helper function can be used to compensate for that.
export function scaleElementsByFactor(array: NumberArray, factor: number): void {
  for (let i = 0; i < array.length; i++) {
    array[i]! *= factor;
  }
}

function isPowerOf2(n: number): boolean {
  return Boolean(n) && !(n & (n - 1));
}

function countBits(n: number): number {
  if (!isPowerOf2(n)) {
    throw new Error("FFT array length must be a power of 2.");
  }
  return Math.round(Math.log(n) / Math.log(2));
}

// Rearranges the elements of the array, swapping the element at an index
// With an element at an index that is the bitwise reverse of the first
// Index in base 2. Useful for computing the FFT.
function reverseIndexBits(array: NumberArray, fullArrayLength: number): void {
  const bitCount: number = countBits(fullArrayLength),
    finalShift: number = 32 - bitCount;
  for (let i = 0; i < fullArrayLength; i++) {
    // Dear JavaScript: Please support bit order reversal intrinsics. Thanks! :D
    let j: number;
    j = ((i >> 1) & 0x55_55_55_55) | ((i & 0x55_55_55_55) << 1);
    j = ((j >> 2) & 0x33_33_33_33) | ((j & 0x33_33_33_33) << 2);
    j = ((j >> 4) & 0x0f_0f_0f_0f) | ((j & 0x0f_0f_0f_0f) << 4);
    j = ((j >> 8) & 0x00_ff_00_ff) | ((j & 0x00_ff_00_ff) << 8);
    j = ((j >> 16) & 0x00_00_ff_ff) | ((j & 0x00_00_ff_ff) << 16);
    j >>>= finalShift;

    if (j > i) {
      const temp: number = array[i]!;
      array[i] = array[j]!;
      array[j] = temp;
    }
  }
}

// Provided for educational purposes. Easier to read than
// FastFourierTransform(), but computes the same result.
// Takes two parallel arrays representing the real and imaginary elements,
// Respectively, and returns an array containing two new arrays, which
// Contain the complex result of the transform.
export function discreteFourierTransform(
  realArray: NumberArray,
  imagArray: NumberArray,
): number[][] {
  const fullArrayLength: number = realArray.length;
  if (fullArrayLength !== imagArray.length) {
    throw new Error("FFT arrays must be the same length.");
  }
  const realOut: number[] = [],
    imagOut: number[] = [];
  for (let i = 0; i < fullArrayLength; i++) {
    realOut[i] = 0.0;
    imagOut[i] = 0.0;
    for (let j = 0; j < fullArrayLength; j++) {
      const radians: number = (-Math.PI * 2.0 * j * i) / fullArrayLength,
        c: number = Math.cos(radians),
        s: number = Math.sin(radians);
      realOut[i]! += realArray[j]! * c - imagArray[j]! * s;
      imagOut[i]! += realArray[j]! * s + imagArray[j]! * c;
    }
  }
  return [realOut, imagOut];
}

// Performs a Fourier transform in O(N log(N)) operations. Overwrites the
// Input real and imaginary arrays. Can be used for both forward and inverse
// Transforms: swap the order of the arguments for the inverse.
export function fastFourierTransform(realArray: NumberArray, imagArray: NumberArray): void {
  const fullArrayLength: number = realArray.length;
  if (!isPowerOf2(fullArrayLength)) {
    throw new Error("FFT array length must be a power of 2.");
  }
  if (fullArrayLength < 4) {
    throw new Error("FFT array length must be at least 4.");
  }
  if (fullArrayLength !== imagArray.length) {
    throw new Error("FFT arrays must be the same length.");
  }

  reverseIndexBits(realArray, fullArrayLength);
  reverseIndexBits(imagArray, fullArrayLength);

  // First two passes, with strides of 2 and 4, can be combined and optimized.
  for (let startIndex = 0; startIndex < fullArrayLength; startIndex += 4) {
    const startIndex1: number = startIndex + 1,
      startIndex2: number = startIndex + 2,
      startIndex3: number = startIndex + 3,
      real0: number = realArray[startIndex]!,
      real1: number = realArray[startIndex1]!,
      real2: number = realArray[startIndex2]!,
      real3: number = realArray[startIndex3]!,
      imag0: number = imagArray[startIndex]!,
      imag1: number = imagArray[startIndex1]!,
      imag2: number = imagArray[startIndex2]!,
      imag3: number = imagArray[startIndex3]!,
      realTemp0: number = real0 + real1,
      realTemp1: number = real0 - real1,
      realTemp2: number = real2 + real3,
      realTemp3: number = real2 - real3,
      imagTemp0: number = imag0 + imag1,
      imagTemp1: number = imag0 - imag1,
      imagTemp2: number = imag2 + imag3,
      imagTemp3: number = imag2 - imag3;
    realArray[startIndex] = realTemp0 + realTemp2;
    realArray[startIndex1] = realTemp1 + imagTemp3;
    realArray[startIndex2] = realTemp0 - realTemp2;
    realArray[startIndex3] = realTemp1 - imagTemp3;
    imagArray[startIndex] = imagTemp0 + imagTemp2;
    imagArray[startIndex1] = imagTemp1 - realTemp3;
    imagArray[startIndex2] = imagTemp0 - imagTemp2;
    imagArray[startIndex3] = imagTemp1 + realTemp3;
  }

  for (let stride = 8; stride <= fullArrayLength; stride += stride) {
    const halfLength: number = stride >>> 1,
      radiansIncrement: number = (Math.PI * 2.0) / stride,
      cosIncrement: number = Math.cos(radiansIncrement),
      sinIncrement: number = Math.sin(radiansIncrement),
      oscillatorMultiplier: number = 2.0 * cosIncrement;
    for (let startIndex = 0; startIndex < fullArrayLength; startIndex += stride) {
      let c = 1.0,
        s = 0.0,
        cPrev: number = cosIncrement,
        sPrev: number = sinIncrement;
      const secondHalf: number = startIndex + halfLength;
      for (let i: number = startIndex; i < secondHalf; i++) {
        const j: number = i + halfLength,
          real0: number = realArray[i]!,
          imag0: number = imagArray[i]!,
          real1: number = realArray[j]! * c - imagArray[j]! * s,
          imag1: number = realArray[j]! * s + imagArray[j]! * c;
        realArray[i] = real0 + real1;
        imagArray[i] = imag0 + imag1;
        realArray[j] = real0 - real1;
        imagArray[j] = imag0 - imag1;
        const cTemp: number = oscillatorMultiplier * c - cPrev,
          sTemp: number = oscillatorMultiplier * s - sPrev;
        cPrev = c;
        sPrev = s;
        c = cTemp;
        s = sTemp;
      }
    }
  }
}

// Computes the Fourier transform from an array of real-valued time-domain
// Samples. The output is specially formatted for space efficieny: elements
// 0 through N/2 represent cosine wave amplitudes in ascending frequency,
// And elements N/2+1 through N-1 represent sine wave amplitudes in
// Descending frequency. Overwrites the input array.
export function forwardRealFourierTransform(array: NumberArray): void {
  const fullArrayLength: number = array.length,
    totalPasses: number = countBits(fullArrayLength);
  if (fullArrayLength < 4) {
    throw new Error("FFT array length must be at least 4.");
  }

  reverseIndexBits(array, fullArrayLength);

  // First and second pass.
  for (let index = 0; index < fullArrayLength; index += 4) {
    const index1: number = index + 1,
      index2: number = index + 2,
      index3: number = index + 3,
      real0: number = array[index]!,
      real1: number = array[index1]!,
      real2: number = array[index2]!,
      real3: number = array[index3]!,
      // No imaginary elements yet since the input is fully real.
      tempA: number = real0 + real1,
      tempB: number = real2 + real3;
    array[index] = tempA + tempB;
    array[index1] = real0 - real1;
    array[index2] = tempA - tempB;
    array[index3] = real2 - real3;
  }

  // Third pass.
  const sqrt2over2: number = Math.sqrt(2.0) / 2.0;
  for (let index = 0; index < fullArrayLength; index += 8) {
    const index1: number = index + 1,
      index3: number = index + 3,
      index4: number = index + 4,
      index5: number = index + 5,
      index7: number = index + 7,
      real0: number = array[index]!,
      real1: number = array[index1]!,
      imag3: number = array[index3]!,
      real4: number = array[index4]!,
      real5: number = array[index5]!,
      imag7: number = array[index7]!,
      tempA: number = (real5 - imag7) * sqrt2over2,
      tempB: number = (real5 + imag7) * sqrt2over2;
    array[index] = real0 + real4;
    array[index1] = real1 + tempA;
    array[index3] = real1 - tempA;
    array[index4] = real0 - real4;
    array[index5] = tempB - imag3;
    array[index7] = tempB + imag3;
  }

  // Handle remaining passes.
  for (let pass = 3; pass < totalPasses; pass++) {
    const subStride: number = 1 << pass,
      midSubStride: number = subStride >> 1,
      stride: number = subStride << 1,
      radiansIncrement: number = (Math.PI * 2.0) / stride,
      cosIncrement: number = Math.cos(radiansIncrement),
      sinIncrement: number = Math.sin(radiansIncrement),
      oscillatorMultiplier: number = 2.0 * cosIncrement;
    for (let startIndex = 0; startIndex < fullArrayLength; startIndex += stride) {
      const startIndexA: number = startIndex,
        startIndexB: number = startIndexA + subStride,
        stopIndex: number = startIndexB + subStride,
        realStartA: number = array[startIndexA]!,
        realStartB: number = array[startIndexB]!;
      array[startIndexA] = realStartA + realStartB;
      array[startIndexB] = realStartA - realStartB;
      let c: number = cosIncrement,
        s: number = -sinIncrement,
        cPrev = 1.0,
        sPrev = 0.0;
      for (let index = 1; index < midSubStride; index++) {
        const indexA0: number = startIndexA + index,
          indexA1: number = startIndexB - index,
          indexB0: number = startIndexB + index,
          indexB1: number = stopIndex - index,
          real0: number = array[indexA0]!,
          imag0: number = array[indexA1]!,
          real1: number = array[indexB0]!,
          imag1: number = array[indexB1]!,
          tempA: number = real1 * c + imag1 * s,
          tempB: number = real1 * s - imag1 * c;
        array[indexA0] = real0 + tempA;
        array[indexA1] = real0 - tempA;
        array[indexB0] = -imag0 - tempB;
        array[indexB1] = imag0 - tempB;
        const cTemp: number = oscillatorMultiplier * c - cPrev,
          sTemp: number = oscillatorMultiplier * s - sPrev;
        cPrev = c;
        sPrev = s;
        c = cTemp;
        s = sTemp;
      }
    }
  }
}

// Computes the inverse Fourier transform from a specially formatted array of
// Scalar values. Elements 0 through N/2 are expected to be the real values of
// The corresponding complex elements, representing cosine wave amplitudes in
// Ascending frequency, and elements N/2+1 through N-1 correspond to the
// Imaginary values, representing sine wave amplitudes in descending frequency.
// Generates real-valued time-domain samples. Overwrites the input array.
export function inverseRealFourierTransform(array: NumberArray, fullArrayLength: number): void {
  const totalPasses: number = countBits(fullArrayLength);
  if (fullArrayLength < 4) {
    throw new Error("FFT array length must be at least 4.");
  }

  // Perform all but the last few passes in reverse.
  for (let pass: number = totalPasses - 1; pass >= 2; pass--) {
    const subStride: number = 1 << pass,
      midSubStride: number = subStride >> 1,
      stride: number = subStride << 1,
      radiansIncrement: number = (Math.PI * 2.0) / stride,
      cosIncrement: number = Math.cos(radiansIncrement),
      sinIncrement: number = Math.sin(radiansIncrement),
      oscillatorMultiplier: number = 2.0 * cosIncrement;

    for (let startIndex = 0; startIndex < fullArrayLength; startIndex += stride) {
      const startIndexA: number = startIndex,
        midIndexA: number = startIndexA + midSubStride,
        startIndexB: number = startIndexA + subStride,
        midIndexB: number = startIndexB + midSubStride,
        stopIndex: number = startIndexB + subStride,
        realStartA: number = array[startIndexA]!,
        imagStartB: number = array[startIndexB]!;
      array[startIndexA] = realStartA + imagStartB;
      array[midIndexA]! *= 2;
      array[startIndexB] = realStartA - imagStartB;
      array[midIndexB]! *= 2;
      let c: number = cosIncrement,
        s: number = -sinIncrement,
        cPrev = 1.0,
        sPrev = 0.0;
      for (let index = 1; index < midSubStride; index++) {
        const indexA0: number = startIndexA + index,
          indexA1: number = startIndexB - index,
          indexB0: number = startIndexB + index,
          indexB1: number = stopIndex - index,
          real0: number = array[indexA0]!,
          real1: number = array[indexA1]!,
          imag0: number = array[indexB0]!,
          imag1: number = array[indexB1]!,
          tempA: number = real0 - real1,
          tempB: number = imag0 + imag1;
        array[indexA0] = real0 + real1;
        array[indexA1] = imag1 - imag0;
        array[indexB0] = tempA * c - tempB * s;
        array[indexB1] = tempB * c + tempA * s;
        const cTemp: number = oscillatorMultiplier * c - cPrev,
          sTemp: number = oscillatorMultiplier * s - sPrev;
        cPrev = c;
        sPrev = s;
        c = cTemp;
        s = sTemp;
      }
    }
  }
  /*
	// Commented out this block (and compensated with an extra pass above)
	// because it's slower in my testing so far.
	// Pass with stride 8.
	const sqrt2over2: number = Math.sqrt(2.0) / 2.0;
	for (let index: number = 0; index < fullArrayLength; index += 8) {
		const index1: number = index + 1;
		const index2: number = index + 2;
		const index3: number = index + 3;
		const index4: number = index + 4;
		const index5: number = index + 5;
		const index6: number = index + 6;
		const index7: number = index + 7;
		const real0: number = array[index ];
		const real1: number = array[index1];
		const real2: number = array[index2];
		const real3: number = array[index3];
		const imag4: number = array[index4];
		const imag5: number = array[index5];
		const imag6: number = array[index6];
		const imag7: number = array[index7];
		const tempA: number = real1 - real3;
		const tempB: number = imag5 + imag7;
		array[index ] = real0 + imag4;
		array[index1] = real1 + real3;
		array[index2] = real2 * 2;
		array[index3] = imag7 - imag5;
		array[index4] = real0 - imag4;
		array[index5] = (tempA + tempB) * sqrt2over2;
		array[index6] = imag6 * 2;
		array[index7] = (tempB - tempA) * sqrt2over2;
	}
	*/
  // The final passes with strides 4 and 2, combined into one loop.
  for (let index = 0; index < fullArrayLength; index += 4) {
    const index1: number = index + 1,
      index2: number = index + 2,
      index3: number = index + 3,
      real0: number = array[index]!,
      real1: number = array[index1]! * 2,
      imag2: number = array[index2]!,
      imag3: number = array[index3]! * 2,
      tempA: number = real0 + imag2,
      tempB: number = real0 - imag2;
    array[index] = tempA + real1;
    array[index1] = tempA - real1;
    array[index2] = tempB + imag3;
    array[index3] = tempB - imag3;
  }

  reverseIndexBits(array, fullArrayLength);
}
