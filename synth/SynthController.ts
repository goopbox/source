// Copyright (c) John Nesky and contributing authors, distributed under the MIT license.

import { Config, type AssetDefinition } from "./SynthConfig.js";
import { Song, SynthEngine } from "./synth.js";
import type { Note } from "./synth.js";
import type {
  LiveInputState,
  SynthCommand,
  SynthEvent,
  TransportSnapshot,
} from "./audio-worklet-protocol.js";
import {
  getSoundFontInstrumentSettings,
  parseSoundFont,
  type SoundFontInstrumentSettings,
} from "./SoundFont.js";
import { cacheAsset } from "./AssetCache.js";

export type AssetLoadStatus = "loading" | "loaded" | "error";
export interface SampleAssetData {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}
export interface SamplePreviewSettings {
  readonly offsetFrame: number;
  readonly loopStartFrame: number;
  readonly loopEndFrame: number;
  readonly oneshot: boolean;
}
export interface SoundFontPresetInfo {
  readonly index: number;
  readonly name: string;
  readonly bankMSB: number;
  readonly bankLSB: number;
  readonly program: number;
  readonly isDrum: boolean;
  readonly settings: SoundFontInstrumentSettings;
}

export class SynthController {
  public static adjacentNotesHaveMatchingPitches(
    firstNote: Note,
    secondNote: Note,
  ): boolean {
    return SynthEngine.adjacentNotesHaveMatchingPitches(firstNote, secondNote);
  }
  public static instrumentVolumeToVolumeMult(value: number): number {
    return SynthEngine.instrumentVolumeToVolumeMult(value);
  }
  public static volumeMultToInstrumentVolume(value: number): number {
    return SynthEngine.volumeMultToInstrumentVolume(value);
  }
  public static noteSizeToVolumeMult(value: number): number {
    return SynthEngine.noteSizeToVolumeMult(value);
  }
  public static volumeMultToNoteSize(value: number): number {
    return SynthEngine.volumeMultToNoteSize(value);
  }
  public static fadeInSettingToSeconds(value: number): number {
    return SynthEngine.fadeInSettingToSeconds(value);
  }
  public static secondsToFadeInSetting(value: number): number {
    return SynthEngine.secondsToFadeInSetting(value);
  }
  public static fadeOutSettingToTicks(value: number): number {
    return SynthEngine.fadeOutSettingToTicks(value);
  }
  public static ticksToFadeOutSetting(value: number): number {
    return SynthEngine.ticksToFadeOutSetting(value);
  }
  public static detuneToCents(value: number): number {
    return SynthEngine.detuneToCents(value);
  }
  public static centsToDetune(value: number): number {
    return SynthEngine.centsToDetune(value);
  }

  public preferLowerLatency: boolean = false;
  public anticipatePoorPerformance: boolean = false;
  public song: Song;
  public audioError: string | null = null;
  public readonly assetLoadEvents: EventTarget = new EventTarget();

  private audioContext: AudioContext | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private outputGainNode: GainNode | null = null;
  private samplePreviewSource: AudioBufferSourceNode | null = null;
  private audioInitialization: Promise<void> | null = null;
  private songSyncFrame: number | null = null;
  private lastSerializedSong: Uint8Array | null = null;
  private lastMutedChannels: string | null = null;
  private errorWasShown: boolean = false;
  private readonly assetLoadStates: Map<string, AssetLoadStatus> = new Map();
  private readonly assetLoadProgress: Map<string, number | null> = new Map();
  private readonly assetLoadErrors: Map<string, string> = new Map();
  private readonly assetLoads: Map<string, Promise<void>> = new Map();
  private readonly sampleAssets: Map<string, SampleAssetData> = new Map();
  private readonly soundFontAssets: Map<string, ArrayBuffer> = new Map();
  private readonly soundFontPresets: Map<
    string,
    readonly SoundFontPresetInfo[]
  > = new Map();

  private desiredPlaying: boolean = false;
  private desiredRecording: boolean = false;
  private reportedPlayhead: number = 0;
  private reportedPreviousBar: number | null = null;
  private reportedTempo: number = 120;
  private reportContextTime: number = 0;
  private reportedCountIn: boolean = false;
  private loopRepeatCountInternal: number = -1;
  private metronomeEnabledInternal: boolean = false;
  private countInEnabledInternal: boolean = false;
  private readonly livePitches: number[] = [];
  private readonly liveInstruments: number[] = [];
  private liveDuration: number = 0;
  private liveStarted: boolean = false;
  private liveChannel: number = 0;
  private masterVolumeInternal: number = 1.0;

  public constructor(song: Song | Uint8Array | null = null) {
    this.song = song instanceof Song ? song : new Song(song ?? undefined);
    this.reportedTempo = this.song.tempo;
    this.refreshAssetLoads();
  }

  public setSong(song: Song | Uint8Array): void {
    this.song = song instanceof Song ? song : new Song(song);
    this.reportedTempo = this.song.tempo;
    this.reportedPlayhead = Math.min(this.reportedPlayhead, this.song.barCount);
    this.lastSerializedSong = null;
    this.lastMutedChannels = null;
    this.refreshAssetLoads();
    this.syncSong();
  }

  public getAssetLoadStatus(sampleId: string): AssetLoadStatus | null {
    return this.assetLoadStates.get(sampleId) ?? null;
  }

  public getAssetLoadProgress(sampleId: string): number | null {
    return this.assetLoadProgress.get(sampleId) ?? null;
  }

  public getAssetLoadError(sampleId: string): string | null {
    return this.assetLoadErrors.get(sampleId) ?? null;
  }

  public getSampleAsset(sampleId: string): SampleAssetData | null {
    return this.sampleAssets.get(sampleId) ?? null;
  }

  public async loadAssetsInto(synth: SynthEngine): Promise<void> {
    this.refreshAssetLoads();
    await Promise.all(
      this.song.assets.flatMap((asset: AssetDefinition): Promise<void>[] => {
        const load: Promise<void> | undefined = this.assetLoads.get(asset.id);
        return load == undefined ? [] : [load];
      }),
    );

    for (const asset of this.song.assets) {
      if (asset.type == "soundFont") {
        const data: ArrayBuffer | undefined = this.soundFontAssets.get(
          asset.id,
        );
        if (data != undefined) {
          synth.setSoundFont(asset.id, data);
          continue;
        }
      } else {
        const data: SampleAssetData | undefined = this.sampleAssets.get(
          asset.id,
        );
        if (data != undefined) {
          synth.setAsset(asset.id, data.samples, data.sampleRate);
          continue;
        }
      }

      throw new Error(
        `Failed to load asset ${asset.name}: ${this.assetLoadErrors.get(asset.id) ?? "Unknown error"}`,
      );
    }
  }

  public playSamplePreview(
    sampleId: string,
    settings: SamplePreviewSettings,
    onEnded: () => void,
  ): boolean {
    const sample: SampleAssetData | undefined = this.sampleAssets.get(sampleId);
    const context: AudioContext | null = this.audioContext;
    const output: GainNode | null = this.outputGainNode;
    if (
      sample == undefined ||
      sample.samples.length == 0 ||
      context == null ||
      output == null
    )
      return false;

    this.stopSamplePreviewInternal(false);
    const sampleLength: number = sample.samples.length;
    const loopStartFrame: number = Math.max(
      0,
      Math.min(sampleLength - 1, settings.loopStartFrame),
    );
    const loopEndFrame: number = Math.max(
      loopStartFrame + 1,
      Math.min(sampleLength, settings.loopEndFrame),
    );
    let offsetFrame: number = Math.max(
      0,
      Math.min(loopEndFrame, settings.offsetFrame),
    );
    if (!settings.oneshot && offsetFrame >= loopEndFrame)
      offsetFrame = loopStartFrame;
    const buffer: AudioBuffer = context.createBuffer(
      1,
      sampleLength,
      sample.sampleRate,
    );
    buffer.getChannelData(0).set(sample.samples);
    const source: AudioBufferSourceNode = context.createBufferSource();
    source.buffer = buffer;
    source.loop = !settings.oneshot;
    source.loopStart = loopStartFrame / sample.sampleRate;
    source.loopEnd = loopEndFrame / sample.sampleRate;
    source.connect(output);
    source.onended = (): void => {
      if (this.samplePreviewSource != source) return;
      source.disconnect();
      this.samplePreviewSource = null;
      this.suspendAudioIfIdle();
      onEnded();
    };
    this.samplePreviewSource = source;
    if (context.state == "suspended")
      void context.resume().catch((): void => {
        /* Retried by the next user interaction. */
      });
    const offsetSeconds: number = offsetFrame / sample.sampleRate;
    if (settings.oneshot) {
      source.start(
        0,
        offsetSeconds,
        (loopEndFrame - offsetFrame) / sample.sampleRate,
      );
    } else {
      source.start(0, offsetSeconds);
    }
    return true;
  }

  public stopSamplePreview(): void {
    this.stopSamplePreviewInternal(true);
  }

  private stopSamplePreviewInternal(suspendAudio: boolean): void {
    const source: AudioBufferSourceNode | null = this.samplePreviewSource;
    if (source == null) return;
    this.samplePreviewSource = null;
    source.onended = null;
    source.stop();
    source.disconnect();
    if (suspendAudio) this.suspendAudioIfIdle();
  }

  public getSoundFontPresets(
    soundFontId: string,
  ): readonly SoundFontPresetInfo[] | null {
    return this.soundFontPresets.get(soundFontId) ?? null;
  }

  public get playing(): boolean {
    return this.desiredPlaying;
  }

  public get recording(): boolean {
    return this.desiredRecording;
  }

  public get masterVolume(): number {
    return this.masterVolumeInternal;
  }

  public set masterVolume(value: number) {
    this.masterVolumeInternal = Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 1.0;
    if (this.outputGainNode != null)
      this.outputGainNode.gain.value = this.masterVolumeInternal;
  }

  public get playhead(): number {
    if (
      this.desiredPlaying &&
      !this.reportedCountIn &&
      this.audioContext != null &&
      this.audioContext.state == "running"
    ) {
      const elapsed: number = Math.max(
        0,
        this.audioContext.currentTime - this.reportContextTime,
      );
      const estimated: number =
        this.reportedPlayhead +
        (elapsed * this.reportedTempo) / (60 * this.song.beatsPerBar);
      return Math.max(0, Math.min(this.song.barCount, estimated));
    }
    return this.reportedPlayhead;
  }

  public set playhead(value: number) {
    this.reportedPlayhead = Math.max(0, Math.min(this.song.barCount, value));
    this.reportedPreviousBar = null;
    this.markReportTime();
    this.post({ type: "setPlayhead", playhead: this.reportedPlayhead });
  }

  public getPreviousBar(bar: number): number | null {
    // The visual playhead can advance beyond the latest audio report.
    return bar > Math.floor(this.reportedPlayhead)
      ? bar - 1
      : this.reportedPreviousBar;
  }

  public get loopRepeatCount(): number {
    return this.loopRepeatCountInternal;
  }
  public set loopRepeatCount(value: number) {
    this.loopRepeatCountInternal = value;
    this.post({ type: "setLoopRepeatCount", loopRepeatCount: value });
  }

  public get enableMetronome(): boolean {
    return this.metronomeEnabledInternal;
  }
  public set enableMetronome(value: boolean) {
    this.metronomeEnabledInternal = value;
    this.post({ type: "setMetronomeEnabled", enabled: value });
  }

  public get countInMetronome(): boolean {
    return this.countInEnabledInternal;
  }
  public set countInMetronome(value: boolean) {
    this.countInEnabledInternal = value;
    this.reportedCountIn = value;
    this.post({ type: "setCountInEnabled", enabled: value });
  }

  public get liveInputPitches(): readonly number[] {
    return this.livePitches;
  }
  public get liveInputChannel(): number {
    return this.liveChannel;
  }
  public get liveInputInstruments(): readonly number[] {
    return this.liveInstruments;
  }

  private latencyHint(): AudioContextLatencyCategory {
    return this.anticipatePoorPerformance
      ? this.preferLowerLatency
        ? "balanced"
        : "playback"
      : this.preferLowerLatency
        ? "interactive"
        : "balanced";
  }

  private liveInputState(): LiveInputState {
    return {
      pitches: this.livePitches,
      channel: this.liveChannel,
      instruments: this.liveInstruments,
      duration: this.liveDuration,
      started: this.liveStarted,
    };
  }

  private mutedChannels(): boolean[] {
    return this.song.channels.map((channel): boolean => channel.muted);
  }

  private ensureAudio(): Promise<void> {
    if (this.audioWorkletNode != null && this.audioContext != null)
      return Promise.resolve();
    if (this.audioInitialization != null) return this.audioInitialization;

    this.audioInitialization = (async (): Promise<void> => {
      const context: AudioContext =
        this.audioContext ??
        new AudioContext({ latencyHint: this.latencyHint() });
      this.audioContext = context;
      if (context.state == "suspended")
        void context.resume().catch((): void => {
          /* Retried after module loading below. */
        });
      await context.audioWorklet.addModule(
        new URL("synth_worklet.js", document.baseURI),
      );
      const node: AudioWorkletNode = new AudioWorkletNode(
        context,
        "synth-processor",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: "explicit",
          channelInterpretation: "speakers",
        },
      );
      node.port.onmessage = (event: MessageEvent<SynthEvent>): void =>
        this.handleEvent(event.data);
      node.onprocessorerror = (): void =>
        this.reportAudioError("The audio worklet stopped unexpectedly.");
      const outputGainNode: GainNode = context.createGain();
      outputGainNode.gain.value = this.masterVolumeInternal;
      node.connect(outputGainNode);
      outputGainNode.connect(context.destination);
      this.audioWorkletNode = node;
      this.outputGainNode = outputGainNode;

      const song: Uint8Array = this.song.toBinary();
      this.lastSerializedSong = song;
      const mutedChannels: boolean[] = this.mutedChannels();
      this.lastMutedChannels = mutedChannels
        .map((muted: boolean): string => (muted ? "1" : "0"))
        .join("");
      this.post({
        type: "initialize",
        song,
        mutedChannels,
        playhead: this.reportedPlayhead,
        playing: this.desiredPlaying,
        recording: this.desiredRecording,
        loopRepeatCount: this.loopRepeatCountInternal,
        metronomeEnabled: this.metronomeEnabledInternal,
        countInEnabled: this.countInEnabledInternal,
        liveInput: this.liveInputState(),
      });
    })().catch((error: unknown): never => {
      this.audioWorkletNode?.disconnect();
      this.audioWorkletNode = null;
      this.outputGainNode?.disconnect();
      this.outputGainNode = null;
      this.audioInitialization = null;
      const message: string =
        error instanceof Error ? error.message : String(error);
      this.reportAudioError(`Unable to initialize audio: ${message}`);
      throw error;
    });
    return this.audioInitialization;
  }

  private activateAudio(): void {
    if (this.audioContext?.state == "suspended")
      void this.audioContext.resume().catch((): void => {
        /* Retried after initialization below. */
      });
    void this.ensureAudio()
      .then(async (): Promise<void> => {
        if (this.audioContext?.state == "suspended")
          await this.audioContext.resume();
      })
      .catch((): void => {
        /* reportAudioError already exposed the failure. */
      });
  }

  private reportAudioError(message: string): void {
    this.audioError = message;
    console.error(message);
    if (!this.errorWasShown) {
      this.errorWasShown = true;
      window.alert(message);
    }
  }

  private suspendAudioIfIdle(): void {
    if (
      !this.desiredPlaying &&
      this.livePitches.length == 0 &&
      this.samplePreviewSource == null &&
      this.audioContext?.state == "running"
    )
      void this.audioContext.suspend();
  }

  private post(command: SynthCommand, transfer: Transferable[] = []): void {
    this.audioWorkletNode?.port.postMessage(command, transfer);
  }

  private setAssetLoadStatus(sampleId: string, status: AssetLoadStatus): void {
    if (this.assetLoadStates.get(sampleId) == status) return;
    this.assetLoadStates.set(sampleId, status);
    this.assetLoadEvents.dispatchEvent(new Event("change"));
  }

  private setAssetLoadProgress(
    sampleId: string,
    progress: number | null,
  ): void {
    this.assetLoadProgress.set(sampleId, progress);
    this.assetLoadEvents.dispatchEvent(new Event("change"));
  }

  private refreshAssetLoads(): void {
    const activeSampleIds: Set<string> = new Set(
      this.song.assets.map((sample: AssetDefinition): string => sample.id),
    );
    for (const sampleId of this.assetLoadStates.keys()) {
      if (!activeSampleIds.has(sampleId)) {
        this.assetLoadStates.delete(sampleId);
        this.assetLoadProgress.delete(sampleId);
        this.assetLoadErrors.delete(sampleId);
        this.sampleAssets.delete(sampleId);
        this.soundFontAssets.delete(sampleId);
        this.soundFontPresets.delete(sampleId);
      }
    }
    for (const sample of this.song.assets) {
      if (this.assetLoadStates.has(sample.id)) continue;
      this.assetLoadErrors.delete(sample.id);
      this.setAssetLoadStatus(sample.id, "loading");
      this.setAssetLoadProgress(sample.id, null);
      const load: Promise<void> = this.loadAsset(sample);
      this.assetLoads.set(sample.id, load);
      void load.then((): void => {
        if (this.assetLoads.get(sample.id) == load)
          this.assetLoads.delete(sample.id);
      });
    }
  }

  private async readAssetResponse(
    response: Response,
    sampleId: string,
  ): Promise<ArrayBuffer> {
    if (response.body == null) return response.arrayBuffer();
    const reader: ReadableStreamDefaultReader<Uint8Array> =
      response.body.getReader();
    const contentLength: number = Number(
      response.headers.get("content-length"),
    );
    const hasContentLength: boolean =
      Number.isFinite(contentLength) && contentLength > 0;
    const chunks: Uint8Array[] = [];
    let received: number = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value == undefined) continue;
      chunks.push(value);
      received += value.byteLength;
      this.setAssetLoadProgress(
        sampleId,
        hasContentLength ? Math.min(1, received / contentLength) : null,
      );
    }
    const result: ArrayBuffer = new ArrayBuffer(received);
    const resultView: Uint8Array = new Uint8Array(result);
    let offset: number = 0;
    for (const chunk of chunks) {
      resultView.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private async loadAsset(sample: AssetDefinition): Promise<void> {
    try {
      const response: Response = await fetch(sample.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const cacheResponse: Response = response.clone();
      const encodedAudio: ArrayBuffer = await this.readAssetResponse(
        response,
        sample.id,
      );
      if (sample.type == "soundFont") {
        const soundBank = parseSoundFont(encodedAudio);
        const presets: SoundFontPresetInfo[] = soundBank.presets.map(
          (preset, index): SoundFontPresetInfo => ({
            index,
            name: preset.name,
            bankMSB: preset.bankMSB,
            bankLSB: preset.bankLSB,
            program: preset.program,
            isDrum: preset.isDrum,
            settings: getSoundFontInstrumentSettings(preset),
          }),
        );
        if (
          !this.song.assets.some(
            (currentAsset: AssetDefinition): boolean =>
              currentAsset.id == sample.id,
          )
        )
          return;
        this.soundFontPresets.set(sample.id, presets);
        this.soundFontAssets.set(sample.id, encodedAudio);
        await this.ensureAudio();
        if (
          !this.song.assets.some(
            (currentAsset: AssetDefinition): boolean =>
              currentAsset.id == sample.id,
          )
        )
          return;
        const workletData: ArrayBuffer = encodedAudio.slice(0);
        this.post(
          { type: "setSoundFont", soundFontId: sample.id, data: workletData },
          [workletData],
        );
        this.setAssetLoadStatus(sample.id, "loaded");
        cacheAsset(sample, cacheResponse);
        return;
      }
      await this.ensureAudio();
      const context: AudioContext | null = this.audioContext;
      if (context == null) throw new Error("AudioContext unavailable");
      const audioBuffer: AudioBuffer =
        await context.decodeAudioData(encodedAudio);
      if (
        !this.song.assets.some(
          (currentSample: AssetDefinition): boolean =>
            currentSample.id == sample.id,
        )
      )
        return;

      const pcmBuffer: ArrayBuffer = new ArrayBuffer(
        audioBuffer.length * Float32Array.BYTES_PER_ELEMENT,
      );
      const pcm: Float32Array = new Float32Array(pcmBuffer);
      const channelCount: number = audioBuffer.numberOfChannels;
      if (channelCount == 1) {
        pcm.set(audioBuffer.getChannelData(0));
      } else {
        for (
          let channelIndex: number = 0;
          channelIndex < channelCount;
          channelIndex++
        ) {
          const channelData: Float32Array =
            audioBuffer.getChannelData(channelIndex);
          for (
            let sampleIndex: number = 0;
            sampleIndex < pcm.length;
            sampleIndex++
          )
            pcm[sampleIndex] += channelData[sampleIndex] / channelCount;
        }
      }

      this.sampleAssets.set(sample.id, {
        samples: pcm,
        sampleRate: audioBuffer.sampleRate,
      });
      const workletBuffer: ArrayBuffer = pcm.slice().buffer;
      this.post(
        {
          type: "setAsset",
          sampleId: sample.id,
          samples: workletBuffer,
          sampleRate: audioBuffer.sampleRate,
        },
        [workletBuffer],
      );
      this.setAssetLoadStatus(sample.id, "loaded");
      cacheAsset(sample, cacheResponse);
    } catch (error: unknown) {
      if (
        !this.song.assets.some(
          (currentSample: AssetDefinition): boolean =>
            currentSample.id == sample.id,
        )
      )
        return;
      const message: string =
        error instanceof Error ? error.message : String(error);
      this.sampleAssets.delete(sample.id);
      this.soundFontAssets.delete(sample.id);
      this.soundFontPresets.delete(sample.id);
      this.assetLoadErrors.set(sample.id, message);
      this.setAssetLoadStatus(sample.id, "error");
      console.warn(`Failed to load asset ${sample.url}: ${message}`);
    }
  }

  private markReportTime(): void {
    this.reportContextTime = this.audioContext?.currentTime ?? 0;
  }

  private applySnapshot(snapshot: TransportSnapshot): void {
    this.reportedPlayhead = snapshot.playhead;
    this.reportedPreviousBar = snapshot.previousBar;
    this.reportedTempo = snapshot.tempo;
    this.desiredPlaying = snapshot.playing;
    this.desiredRecording = snapshot.recording;
    this.reportedCountIn = snapshot.countIn;
    this.countInEnabledInternal = snapshot.countIn;
    this.markReportTime();
  }

  private handleEvent(event: SynthEvent): void {
    switch (event.type) {
      case "ready":
      case "transport":
      case "playbackEnded":
        this.applySnapshot(event);
        break;
      case "initializationError":
        this.reportAudioError(
          `Unable to initialize synthesizer: ${event.message}`,
        );
        break;
      case "idle":
        this.suspendAudioIfIdle();
        break;
    }
  }

  public syncSong(): void {
    this.refreshAssetLoads();
    if (this.songSyncFrame != null) return;
    this.songSyncFrame = requestAnimationFrame((): void => {
      this.songSyncFrame = null;
      const serialized: Uint8Array = this.song.toBinary();
      const mutedChannels: boolean[] = this.mutedChannels();
      const mutedFingerprint: string = mutedChannels
        .map((muted: boolean): string => (muted ? "1" : "0"))
        .join("");
      if (
        this.serializedSongsMatch(serialized, this.lastSerializedSong) &&
        mutedFingerprint == this.lastMutedChannels
      )
        return;
      this.lastSerializedSong = serialized;
      this.lastMutedChannels = mutedFingerprint;
      this.post({ type: "setSong", song: serialized, mutedChannels });
    });
  }

  private serializedSongsMatch(
    first: Uint8Array,
    second: Uint8Array | null,
  ): boolean {
    if (second == null || first.length != second.length) return false;
    for (let index: number = 0; index < first.length; index++) {
      if (first[index] != second[index]) return false;
    }
    return true;
  }

  public maintainLiveInput(): void {
    this.activateAudio();
    this.post({ type: "maintainLiveInput" });
  }

  public setLiveInputState(
    pitches: readonly number[],
    duration: number,
    started: boolean,
    channel: number = this.liveChannel,
    instruments: readonly number[] = this.liveInstruments,
  ): void {
    const acceptsNotes: boolean =
      channel >= 0 &&
      channel < this.song.getChannelCount() &&
      !this.song.getChannelIsAutomation(channel);
    const safePitches: readonly number[] = acceptsNotes ? pitches : [];
    const safeInstruments: readonly number[] = acceptsNotes ? instruments : [];
    this.livePitches.length = Math.min(
      safePitches.length,
      Config.maxChordSize,
    );
    for (let i: number = 0; i < this.livePitches.length; i++)
      this.livePitches[i] = safePitches[i]!;
    this.liveInstruments.length = safeInstruments.length;
    for (let i: number = 0; i < safeInstruments.length; i++)
      this.liveInstruments[i] = safeInstruments[i]!;
    this.liveDuration = acceptsNotes ? duration : 0;
    this.liveStarted = acceptsNotes && started;
    this.liveChannel = channel;
    this.post({ type: "setLiveInput", state: this.liveInputState() });
    if (this.livePitches.length > 0) this.activateAudio();
    this.liveStarted = false;
  }

  public setLiveInputPitches(
    pitches: readonly number[],
    duration: number,
    started: boolean,
  ): void {
    this.setLiveInputState(pitches, duration, started);
  }

  public setLiveInputChannel(channel: number): void {
    this.liveChannel = channel;
    if (this.song.getChannelIsAutomation(channel)) {
      this.setLiveInputState([], 0, false, channel, []);
    } else {
      this.post({ type: "setLiveInputChannel", channel });
    }
  }

  public setLiveInputInstruments(instruments: readonly number[]): void {
    if (this.song.getChannelIsAutomation(this.liveChannel)) instruments = [];
    this.liveInstruments.length = instruments.length;
    for (let i: number = 0; i < instruments.length; i++)
      this.liveInstruments[i] = instruments[i]!;
    this.post({
      type: "setLiveInputInstruments",
      instruments: this.liveInstruments,
    });
  }

  public play(): void {
    if (this.desiredPlaying) return;
    this.desiredPlaying = true;
    this.desiredRecording = false;
    this.markReportTime();
    this.activateAudio();
    this.post({ type: "play" });
  }

  public pause(): void {
    this.reportedPlayhead = this.playhead;
    this.desiredPlaying = false;
    this.desiredRecording = false;
    this.reportedCountIn = false;
    this.post({ type: "pause" });
  }

  public startRecording(): void {
    this.preferLowerLatency = true;
    this.desiredPlaying = true;
    this.desiredRecording = true;
    this.activateAudio();
    this.post({ type: "startRecording" });
  }

  public snapToStart(): void {
    this.reportedPlayhead = 0;
    this.reportedPreviousBar = null;
    this.markReportTime();
    this.post({ type: "snapToStart" });
  }
  public goToBar(bar: number): void {
    this.reportedPlayhead = bar;
    this.reportedPreviousBar = null;
    this.markReportTime();
    this.post({ type: "goToBar", bar });
  }
  public snapToBar(): void {
    this.reportedPlayhead = Math.floor(this.playhead);
    this.reportedPreviousBar = null;
    this.markReportTime();
    this.post({ type: "snapToBar" });
  }
  public jumpIntoLoop(): void {
    if (
      this.reportedPlayhead < this.song.loopStart ||
      this.reportedPlayhead >= this.song.loopStart + this.song.loopLength
    ) {
      this.reportedPlayhead = this.song.loopStart;
      this.reportedPreviousBar = null;
    }
    this.markReportTime();
    this.post({ type: "jumpIntoLoop" });
  }
  public goToNextBar(): void {
    this.reportedPreviousBar = Math.floor(this.playhead);
    this.reportedPlayhead =
      (this.reportedPreviousBar + 1) % this.song.barCount;
    this.markReportTime();
    this.post({ type: "goToNextBar" });
  }
  public goToPrevBar(): void {
    this.reportedPreviousBar = null;
    this.reportedPlayhead =
      (Math.floor(this.playhead) - 1 + this.song.barCount) % this.song.barCount;
    this.markReportTime();
    this.post({ type: "goToPrevBar" });
  }
  public resetEffects(): void {
    this.post({ type: "resetEffects" });
  }

  public dispose(): void {
    if (this.songSyncFrame != null) cancelAnimationFrame(this.songSyncFrame);
    this.songSyncFrame = null;
    this.stopSamplePreviewInternal(false);
    this.post({ type: "shutdown" });
    this.audioWorkletNode?.disconnect();
    this.audioWorkletNode = null;
    this.outputGainNode?.disconnect();
    this.outputGainNode = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.audioInitialization = null;
  }
}
