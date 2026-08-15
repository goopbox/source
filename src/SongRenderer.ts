// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Song, SynthEngine } from "../synth/synth.js";

export class SongRenderer {
  public outputSamplesL!: Float32Array;
  public outputSamplesR!: Float32Array;
  public canceled: boolean = false;

  public async *generate(
    song: Song,
    sampleRate: number,
    enableIntro: boolean,
    enableOutro: boolean,
    loopCount: number,
  ): AsyncGenerator<number> {
    const synth: SynthEngine = new SynthEngine(song);
    await Promise.all(
      song.assets
        .filter((asset) => asset.type == "soundFont")
        .map(async (asset): Promise<void> => {
          const response: Response = await fetch(asset.url);
          if (!response.ok)
            throw new Error(
              `Failed to load SoundFont ${asset.name}: HTTP ${response.status}`,
            );
          synth.setSoundFont(asset.id, await response.arrayBuffer());
        }),
    );
    if (this.canceled) return;
    synth.setSampleRate(sampleRate);
    synth.loopRepeatCount = loopCount - 1;
    if (!enableIntro) {
      for (let introIter: number = 0; introIter < song.loopStart; introIter++) {
        synth.goToNextBar();
      }
    }
    const totalSampleLength: number = Math.ceil(
      synth.getSamplesPerBar() * synth.getTotalBars(enableIntro, enableOutro),
    );
    this.outputSamplesL = new Float32Array(totalSampleLength);
    this.outputSamplesR = new Float32Array(totalSampleLength);

    let sampleIndex: number = 0;
    let samplesPerNextRender: number = 1000;
    while (sampleIndex < totalSampleLength) {
      const stopSample: number = Math.min(
        sampleIndex + samplesPerNextRender,
        totalSampleLength,
      );
      const samplesToRender: number = stopSample - sampleIndex;
      const startMillis: number = performance.now();
      synth.synthesize(
        this.outputSamplesL.subarray(sampleIndex, stopSample),
        this.outputSamplesR.subarray(sampleIndex, stopSample),
        samplesToRender,
      );
      const stopMillis: number = performance.now();
      const elapsedMillis: number = stopMillis - startMillis;
      const targetMillis: number = 1000 / 30;
      samplesPerNextRender = Math.ceil(
        Math.max(
          1000,
          Math.min(500000, (samplesToRender * targetMillis) / elapsedMillis),
        ),
      );
      sampleIndex = stopSample;
      const completionRate: number = sampleIndex / totalSampleLength;
      yield completionRate;
      // Give the browser a chance to render a progress bar.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (this.canceled) return;
    }
  }
}
