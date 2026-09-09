import transient from "@audio/stretch-transient";

const frameSize: number = 2048;
const inputBlockSize: number = 256;

/** One streaming stage. Fixed input blocks make upstream frame emission independent
 * of SynthEngine's output chunks. Only prepare/readInto call the allocating API.
 */
class StretchStream {
  private readonly input: Float32Array = new Float32Array(inputBlockSize);
  private output: Float32Array = new Float32Array(8192);
  private readonly write: (input: Float32Array) => Float32Array;
  public readonly factor: number;
  private written: number = 0;
  private consumed: number = 0;

  public constructor(
    factor: number,
    private readonly source: (input: Float32Array) => void,
  ) {
    // Both hops must be integers. Find the closest ratio with overlapping windows,
    // including exact ratios such as 137/83. Prefer larger hops at equal accuracy.
    let anaHop: number = 1;
    let synHop: number = 1;
    let error: number = Infinity;
    for (let a: number = 1; a <= frameSize / 4; a++) {
      const b: number = Math.max(
        1,
        Math.min(frameSize / 4, Math.round(a * factor)),
      );
      const nextError: number = Math.abs(b / a - factor);
      if (nextError <= error) {
        error = nextError;
        anaHop = a;
        synHop = b;
      }
    }
    this.factor = synHop / anaHop;
    this.write = transient({
      factor,
      frameSize,
      hopSize: synHop,
      anaHop,
      synHop,
    });
  }

  public prepare(end: number, retain: number): void {
    const required: number =
      end - retain + Math.ceil(inputBlockSize * this.factor) + 4;
    if (required > this.output.length) {
      const grown: Float32Array = new Float32Array(
        2 ** Math.ceil(Math.log2(required)),
      );
      for (
        let i: number = Math.max(0, this.written - this.output.length);
        i < this.written;
        i++
      )
        grown[i & (grown.length - 1)] =
          this.output[i & (this.output.length - 1)];
      this.output = grown;
    }
    while (this.written < end) {
      this.source(this.input);
      const block: Float32Array = this.write(this.input);
      for (let i: number = 0; i < block.length; i++)
        this.output[this.written++ & (this.output.length - 1)] = block[i];
    }
  }

  public read(position: number): number {
    const index: number = Math.floor(position);
    if (
      index < 0 ||
      index < this.written - this.output.length ||
      index + 1 >= this.written
    )
      return 0;
    const a: number = this.output[index & (this.output.length - 1)];
    const b: number = this.output[(index + 1) & (this.output.length - 1)];
    return a + (b - a) * (position - index);
  }

  public readInto(input: Float32Array): void {
    this.prepare(this.consumed + input.length + 1, this.consumed);
    for (let i: number = 0; i < input.length; i++)
      input[i] = this.output[this.consumed++ & (this.output.length - 1)];
  }
}

/** A pull adapter in source frames. prepare() runs outside the audio sample loop.
 * Resampling the stretched stream applies note bends and unison without DSP resets.
 * Assets are already loaded, so lookahead is read ahead without delaying the note.
 */
export class TimeStretch {
  public static readonly frameSize: number = frameSize;
  private stream: StretchStream | null = null;
  private wave: Float32Array | null = null;
  private pitch: number = 1;
  private tempo: number = 1;
  private loopStart: number = 0;
  private loopEnd: number = 0;
  private oneshot: boolean = false;
  private inputPhase: number = 0;
  private direction: number = 1;
  private position: number = 0;
  private rate: number = 1;
  private frozenInput: Float32Array | null = null;
  private frozenIndex: number = 0;
  private modulationRange: number = 0;

  public reset(): void {
    this.stream = null;
    this.wave = null;
  }

  private readonly readInput = (input: Float32Array): void => {
    for (let i: number = 0; i < input.length; i++) {
      if (this.tempo == 0) {
        input[i] = this.frozenInput![this.frozenIndex++ % frameSize];
      } else {
        input[i] = interpolateChipWaveSample(
          this.wave!,
          this.inputPhase,
          this.loopStart,
          this.loopEnd,
          this.oneshot,
        );
        this.inputPhase = advanceChipWavePhase(
          this.inputPhase,
          this.direction,
          this.loopStart,
          this.loopEnd,
          this.oneshot,
        );
      }
    }
  };

  public prepare(
    wave: Float32Array,
    phase: number,
    pitch: number,
    tempo: number,
    loopStart: number,
    loopEnd: number,
    oneshot: boolean,
    advance: number,
    modulation: number = 0,
  ): void {
    modulation = 2 ** Math.ceil(Math.log2(Math.max(1, modulation)));
    if (
      modulation > this.modulationRange ||
      this.wave != wave ||
      this.pitch != pitch ||
      this.tempo != tempo ||
      this.loopStart != loopStart ||
      this.loopEnd != loopEnd ||
      this.oneshot != oneshot
    ) {
      this.wave = wave;
      this.pitch = pitch;
      this.tempo = tempo;
      this.loopStart = loopStart;
      this.loopEnd = loopEnd;
      this.oneshot = oneshot;
      this.direction = tempo < 0 || (tempo == 0 && pitch < 0) ? -1 : 1;
      const logFactor: number =
        pitch == 0 || tempo == 0
          ? 0
          : Math.log2(Math.abs(pitch)) - Math.log2(Math.abs(tempo));
      // Cascading only at extreme ratios keeps every stage's windows overlapping
      // without imposing a new numeric range on the instrument settings.
      const stages: number = Math.max(1, Math.ceil(Math.abs(logFactor) / 9));
      const stageFactor: number = 2 ** (logFactor / stages);
      let logAchievedFactor: number = 0;
      let source: (input: Float32Array) => void = this.readInput;
      for (let i: number = 0; i < stages; i++) {
        const stream: StretchStream = new StretchStream(stageFactor, source);
        logAchievedFactor += Math.log2(stream.factor);
        source = (input) => stream.readInto(input);
        this.stream = stream;
      }
      // Using the achieved ratio here keeps the source timeline exact. The only
      // pitch error is the rational-hop approximation (zero for common ratios).
      this.rate =
        pitch == 0
          ? 0
          : tempo == 0
            ? Math.abs(pitch)
            : 2 ** (Math.log2(Math.abs(tempo)) + logAchievedFactor);
      this.modulationRange = modulation;
      this.position = modulation;
      this.inputPhase = advanceChipWavePhase(
        phase,
        (-this.position / 2 ** logAchievedFactor) * this.direction,
        loopStart,
        loopEnd,
        oneshot,
      );
      if (tempo == 0) {
        // A zero source rate is an infinite stretch. Repeat the local analysis
        // window while leaving the synth's source cursor fixed.
        this.frozenInput ??= new Float32Array(frameSize);
        this.frozenIndex = 0;
        for (let i: number = 0; i < frameSize; i++) {
          this.frozenInput[i] = interpolateChipWaveSample(
            wave,
            this.inputPhase,
            loopStart,
            loopEnd,
            oneshot,
          );
          this.inputPhase = advanceChipWavePhase(
            this.inputPhase,
            this.direction,
            loopStart,
            loopEnd,
            oneshot,
          );
        }
      }
    }
    const end: number =
      Math.ceil(
        this.position + Math.abs(advance) * this.rate + this.modulationRange,
      ) + 2;
    const retain: number = Math.max(
      0,
      Math.floor(this.position - this.modulationRange) - 2,
    );
    this.stream!.prepare(end, retain);
  }

  public read(modulation: number = 0): number {
    return this.stream!.read(this.position + modulation * this.direction);
  }

  public advance(baseDelta: number): void {
    this.position += Math.abs(baseDelta) * this.rate;
  }
}

export function interpolateChipWaveSample(
  wave: Float32Array,
  phase: number,
  loopStart: number = 0,
  loopEnd: number = wave.length,
  oneshot: boolean = false,
  referencePhase: number = phase,
): number {
  const waveLength: number = wave.length;
  if (waveLength == 0) return 0.0;
  loopStart = Math.max(0, Math.min(waveLength - 1, loopStart));
  loopEnd = Math.max(loopStart + 1, Math.min(waveLength, loopEnd));
  const loopLength: number = loopEnd - loopStart;
  if (oneshot && referencePhase >= loopEnd) return 0.0;
  if (phase >= loopEnd) {
    if (oneshot) return 0.0;
    phase =
      loopStart +
      ((((phase - loopStart) % loopLength) + loopLength) % loopLength);
  } else if (!oneshot && phase < loopStart && referencePhase >= loopStart) {
    phase =
      loopStart +
      ((((phase - loopStart) % loopLength) + loopLength) % loopLength);
  }
  if (phase < 0) return 0.0;
  const phaseFloor: number = Math.floor(phase);
  const index: number = Math.min(waveLength - 1, phaseFloor);
  const nextIndex: number = index + 1;
  let nextSample: number;
  if (nextIndex >= loopEnd && phase >= loopStart) {
    nextSample = oneshot
      ? 0.0
      : wave[Math.min(waveLength - 1, Math.floor(loopStart))];
  } else if (nextIndex >= waveLength) {
    nextSample = oneshot ? 0.0 : wave[0];
  } else {
    nextSample = wave[nextIndex];
  }
  const ratio: number = phase - phaseFloor;
  return wave[index] + (nextSample - wave[index]) * ratio;
}

export function advanceChipWavePhase(
  phase: number,
  phaseDelta: number,
  loopStart: number,
  loopEnd: number,
  oneshot: boolean,
): number {
  const loopLength: number = loopEnd - loopStart;
  if (!(loopLength > 0)) return loopEnd;
  const nextPhase: number = phase + phaseDelta;
  if (phaseDelta >= 0 && nextPhase >= loopEnd) {
    if (oneshot) return loopEnd;
    return (
      loopStart +
      ((((nextPhase - loopStart) % loopLength) + loopLength) % loopLength)
    );
  }
  if (
    phaseDelta < 0 &&
    phase >= loopStart &&
    nextPhase < loopStart &&
    !oneshot
  ) {
    return (
      loopStart +
      ((((nextPhase - loopStart) % loopLength) + loopLength) % loopLength)
    );
  }
  return nextPhase;
}
