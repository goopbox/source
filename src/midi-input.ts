// Copyright (c) John Nesky and contributing authors, distributed under the MIT license, see accompanying the LICENSE.md file.

import { type AnalogousDrum, MidiEventType, analogousDrumMap } from "./midi.js";
import { Config } from "../synth/synth-config.js";
import type { SongDocument } from "./song-document.js";

// A unique id for this tab.
const id: string = ((Math.random() * 0xff_ff_ff_ff) >>> 0).toString(16);

export class MidiInputHandler {
  public _doc: SongDocument;
  public _triedToRegisterMidiAccess = false;

  public constructor(_doc: SongDocument) {
    this._doc = _doc;
    this.tryRegisteringMidiAccessHandler();
  }

  public async tryRegisteringMidiAccessHandler() {
    if (navigator.requestMIDIAccess == null) {
      return;
    }
    if (this._triedToRegisterMidiAccess) {
      return;
    }
    this._triedToRegisterMidiAccess = true;

    try {
      const midiAccess = await navigator.requestMIDIAccess();

      midiAccess.inputs.forEach(this._registerMidiInput);
      midiAccess.addEventListener("statechange", this._handleStateChange);

      this._takeMidiHandlerFocus();
      window.addEventListener("focus", this._takeMidiHandlerFocus);
    } catch (error) {
      console.error("Failed to get MIDI access", error);
    }
  }

  public _takeMidiHandlerFocus = (_event?: Event) => {
    // Record that this browser tab is the one that should handle midi
    // Events and any other open tabs should ignore midi events for now.
    localStorage.setItem("midiHandlerId", id);
  };

  public _handleStateChange = (event: MIDIConnectionEvent) => {
    const { port } = event;
    if (port == null || port.type !== "input") {
      return;
    }
    const midiInput = port as MIDIInput;

    switch (midiInput.state) {
      case "connected": {
        this._registerMidiInput(midiInput);
        break;
      }
      case "disconnected": {
        this._unregisterMidiInput(midiInput);
        break;
      }
    }
  };

  public _registerMidiInput = (midiInput: MIDIInput) => {
    midiInput.addEventListener("midimessage", this._onMidiMessage as EventListener);
  };

  public _unregisterMidiInput = (midiInput: MIDIInput) => {
    midiInput.removeEventListener("midimessage", this._onMidiMessage as EventListener);
    this._doc.performance.clearAllPitches();
  };

  public _onMidiMessage = (event: MIDIMessageEvent) => {
    // Ignore midi events if disabled or a different tab is handling them.
    if (localStorage.getItem("midiHandlerId") !== id) {
      return;
    }
    if (this._doc.song.getChannelIsAutomation(this._doc.channel)) {
      return;
    }

    const { data } = event;
    if (data == null || data.length < 3) {
      return;
    }
    const isDrum: boolean = this._doc.song.getChannelIsNoise(this._doc.channel),
      eventTypeValue: number | undefined = data[0];
    let key: number | undefined = data[1];
    const velocity: number | undefined = data[2];
    if (eventTypeValue === undefined || key === undefined || velocity === undefined) {
      return;
    }
    let eventType: number = eventTypeValue;
    eventType &= 0xf0;

    if (isDrum) {
      const drum: AnalogousDrum | undefined = analogousDrumMap[key];
      if (drum === undefined) {
        return;
      }
      key = drum.frequency;
    } else {
      if (!this._doc.song.getChannelIsNoise(this._doc.channel)) {
        key -= Config.keys[this._doc.song.key]!.basePitch; // The basePitch of the song key is implicit so don't include it.
      }
      if (key < 0 || key > Config.maxPitch) {
        return;
      }
    }

    if (eventType === MidiEventType.noteOn && velocity === 0) {
      eventType = MidiEventType.noteOff;
    }

    switch (eventType) {
      case MidiEventType.noteOn: {
        this._doc.performance.preferLowLatency();
        this._doc.performance.addPerformedPitch(key);
        break;
      }
      case MidiEventType.noteOff: {
        this._doc.performance.removePerformedPitch(key);
        break;
      }
    }
  };
}
