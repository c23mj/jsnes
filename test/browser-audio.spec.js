import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import NES from "../src/nes.js";
import Speakers from "../src/browser/speakers.js";
import Browser from "../src/browser/index.js";

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

it("matches restored audio to the output device before browser playback starts", (t) => {
  t.mock.method(globalThis, "setInterval", () => 1);
  const nes = new NES({ sampleRate: 44100 });
  nes.loadROM(fs.readFileSync("roms/croom/croom.nes"));
  const snapshot = nes.toJSON();
  const playback = new NES({ sampleRate: 48000 });
  playback.loadROM(fs.readFileSync("roms/croom/croom.nes"));
  playback.fromJSON(snapshot);
  let deviceRate = 48000;
  const browser = {
    nes: playback,
    _speakers: {
      getSampleRate: () => deviceRate,
      start() {},
    },
    _frameTimer: {
      start() {
        assert.equal(playback.papu.sampleRate, deviceRate);
        assert.equal(playback.opts.sampleRate, deviceRate);
      },
    },
  };
  Browser.prototype.start.call(browser);
  let samples = 0;
  playback.opts.onAudioSample = () => samples++;
  for (let frame = 0; frame < 60; frame++) playback.frame();
  assert.ok(samples > 47500 && samples < 48500, `${samples} samples`);
  deviceRate = 44100;
  Browser.prototype.start.call(browser);
  samples = 0;
  for (let frame = 0; frame < 60; frame++) playback.frame();
  assert.ok(samples > 43600 && samples < 44600, `${samples} samples`);
  const deviceSnapshot = new NES({ sampleRate: 48000 });
  deviceSnapshot.loadROM(fs.readFileSync("roms/croom/croom.nes"));
  playback.fromJSON(deviceSnapshot.toJSON());
  deviceRate = 48000;
  Browser.prototype.start.call(browser);
  playback.reset();
  assert.equal(playback.papu.sampleRate, 48000);
});

it("preserves audio timing for accelerated frame execution when changing sample rate", () => {
  const nes = new NES({ sampleRate: 44100 });
  nes.setFramerate(120);
  const timerAt44100 = nes.papu.sampleTimerMax;
  nes.papu.setSampleRate(48000);
  assert.ok(
    Math.abs(nes.papu.sampleTimerMax / timerAt44100 - 44100 / 48000) < 0.001,
  );
});
