// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { Config } from "../synth/SynthConfig.js";
import { SongDocument } from "./SongDocument.js";
import { type AnalogousDrum, analogousDrumMap, MidiEventType } from "./Midi.js";

// A unique id for this tab.
const id: string = ((Math.random() * 0xffffffff) >>> 0).toString(16);

export class MidiInputHandler {
  private _triedToRegisterMidiAccess: boolean = false;

  constructor(private _doc: SongDocument) {
    this.tryRegisteringMidiAccessHandler();
  }

  public async tryRegisteringMidiAccessHandler() {
    if (navigator.requestMIDIAccess == null) return;
    if (this._triedToRegisterMidiAccess) return;
    this._triedToRegisterMidiAccess = true;

    try {
      const midiAccess = await navigator.requestMIDIAccess();

      midiAccess.inputs.forEach(this._registerMidiInput);
      midiAccess.addEventListener("statechange", this._handleStateChange);

      this._takeMidiHandlerFocus();
      window.addEventListener("focus", this._takeMidiHandlerFocus);
    } catch (e) {
      console.error("Failed to get MIDI access", e);
    }
  }

  private _takeMidiHandlerFocus = (_event?: Event) => {
    // Record that this browser tab is the one that should handle midi
    // events and any other open tabs should ignore midi events for now.
    localStorage.setItem("midiHandlerId", id);
  };

  private _handleStateChange = (event: MIDIConnectionEvent) => {
    const port = event.port;
    if (port == null || port.type !== "input") return;
    const midiInput = port as MIDIInput;

    switch (midiInput.state) {
      case "connected":
        this._registerMidiInput(midiInput);
        break;
      case "disconnected":
        this._unregisterMidiInput(midiInput);
        break;
    }
  };

  private _registerMidiInput = (midiInput: MIDIInput) => {
    midiInput.addEventListener("midimessage", this._onMidiMessage as any);
  };

  private _unregisterMidiInput = (midiInput: MIDIInput) => {
    midiInput.removeEventListener("midimessage", this._onMidiMessage as any);
    this._doc.performance.clearAllPitches();
  };

  private _onMidiMessage = (event: MIDIMessageEvent) => {
    // Ignore midi events if disabled or a different tab is handling them.
    if (localStorage.getItem("midiHandlerId") != id) return;

    const data = event.data;
    if (data == null) return;
    const isDrum: boolean = this._doc.song.getChannelIsNoise(this._doc.channel);
    let [eventType, key, velocity] = data;
    eventType &= 0xf0;

    if (isDrum) {
      const drum: AnalogousDrum | undefined = analogousDrumMap[key];
      if (drum != undefined) {
        key = drum.frequency;
      } else {
        return;
      }
    } else {
      if (!this._doc.song.getChannelIsNoise(this._doc.channel)) {
        key -= Config.keys[this._doc.song.key].basePitch; // The basePitch of the song key is implicit so don't include it.
      }
      if (key < 0 || key > Config.maxPitch) return;
    }

    if (eventType == MidiEventType.noteOn && velocity == 0) {
      eventType = MidiEventType.noteOff;
    }

    switch (eventType) {
      case MidiEventType.noteOn:
        this._doc.performance.preferLowLatency();
        this._doc.performance.addPerformedPitch(key);
        break;
      case MidiEventType.noteOff:
        this._doc.performance.removePerformedPitch(key);
        break;
    }
  };
}
