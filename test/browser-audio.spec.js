import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import NES from "../src/nes.js";
import Speakers from "../src/browser/speakers.js";

it("generates audio at the browser device's actual sample rate", () => {
  const originalWindow = globalThis.window;
  let contextsCreated = 0;
  globalThis.window = {
    AudioContext: class {
      constructor() {
        contextsCreated++;
        this.sampleRate = 48000;
      }

      close() {
        return Promise.resolve();
      }
    },
  };

  try {
    const speakers = new Speakers({ onBufferUnderrun: () => {} });
    const sampleRate = speakers.getSampleRate();
    assert.equal(sampleRate, 48000);
    assert.equal(speakers.getSampleRate(), sampleRate);
    assert.equal(contextsCreated, 1);

    let samples = 0;
    const nes = new NES({ sampleRate, onAudioSample: () => samples++ });
    nes.loadROM(fs.readFileSync("roms/croom/croom.nes"));
    for (let i = 0; i < 60; i++) nes.frame();

    // Sixty NTSC frames last just under one second. A 44.1 kHz assumption
    // would leave thousands of samples missing at a 48 kHz device rate.
    assert.ok(samples > 47500 && samples < 48500, `${samples} samples`);
    speakers.stop();
  } finally {
    globalThis.window = originalWindow;
  }
});
