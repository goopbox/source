// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Song, SynthEngine } from "../synth/synth.js";
import { Config } from "../synth/SynthConfig.js";

export interface SongRendererAssetSource {
  loadAssetsInto(synth: SynthEngine): Promise<void>;
}

export class SongRenderer {
  public outputSamplesL!: Float32Array;
  public outputSamplesR!: Float32Array;
  public canceled: boolean = false;

  public constructor(private readonly _assetSource: SongRendererAssetSource) {}

  public async *generate(
    song: Song,
    sampleRate: number,
    enableIntro: boolean,
    enableOutro: boolean,
    loopCount: number,
  ): AsyncGenerator<number> {
    const synth: SynthEngine = new SynthEngine(song);
    await this._assetSource.loadAssetsInto(synth);
    if (this.canceled) return;
    synth.setSampleRate(sampleRate);
    synth.loopRepeatCount = loopCount - 1;
    if (!enableIntro) {
      for (let introIter: number = 0; introIter < song.loopStart; introIter++) {
        synth.goToNextBar();
      }
    }
    const totalBars: number = synth.getTotalBars(enableIntro, enableOutro);
    const totalTicks: number =
      totalBars *
      song.beatsPerBar *
      Config.partsPerBeat *
      Config.ticksPerPart;
    synth.renderTicksRemaining = totalTicks;
    const estimatedSampleLength: number = Math.ceil(
      synth.getSamplesPerBar() * totalBars,
    );
    const chunksL: Float32Array[] = [];
    const chunksR: Float32Array[] = [];
    let renderedSampleCount: number = 0;
    let samplesPerNextRender: number = 1000;
    while (!synth.songEnded) {
      const samplesToRender: number = samplesPerNextRender;
      const chunkL: Float32Array = new Float32Array(samplesToRender);
      const chunkR: Float32Array = new Float32Array(samplesToRender);
      const startMillis: number = performance.now();
      synth.synthesize(chunkL, chunkR, samplesToRender);
      const stopMillis: number = performance.now();
      const rendered: number = synth.lastSynthesizeSampleCount;
      if (rendered > 0) {
        chunksL.push(rendered == chunkL.length ? chunkL : chunkL.slice(0, rendered));
        chunksR.push(rendered == chunkR.length ? chunkR : chunkR.slice(0, rendered));
        renderedSampleCount += rendered;
      }
      const elapsedMillis: number = stopMillis - startMillis;
      const targetMillis: number = 1000 / 30;
      samplesPerNextRender = Math.ceil(
        Math.max(
          1000,
          Math.min(500000, (samplesToRender * targetMillis) / elapsedMillis),
        ),
      );
      const completionRate: number = synth.songEnded
        ? 1
        : Math.min(0.99, renderedSampleCount / Math.max(1, estimatedSampleLength));
      yield completionRate;
      // Give the browser a chance to render a progress bar.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (this.canceled) return;
    }

    this.outputSamplesL = new Float32Array(renderedSampleCount);
    this.outputSamplesR = new Float32Array(renderedSampleCount);
    let offset: number = 0;
    for (let index: number = 0; index < chunksL.length; index++) {
      this.outputSamplesL.set(chunksL[index], offset);
      this.outputSamplesR.set(chunksR[index], offset);
      offset += chunksL[index].length;
    }
  }
}
