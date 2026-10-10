import assert from "node:assert/strict";
import { it } from "node:test";
import FrameTimer from "../src/browser/frame-timer.js";

function harness(t, onFrame) {
  const originalWindow = globalThis.window;
  let nextId = 0;
  let frames = 0;
  let now = 1000;
  const displayedFrames = [];
  const animationFrames = new Map();
  const timeouts = new Map();
  globalThis.window = {
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      animationFrames.set(++nextId, callback);
      return nextId;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
  };
  t.mock.method(globalThis, "setTimeout", (callback) => {
    timeouts.set(++nextId, callback);
    return nextId;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => timeouts.delete(id));
  const timer = new FrameTimer({
    onGenerateFrame() {
      frames++;
      onFrame?.(timer);
    },
    onWriteFrame() {
      displayedFrames.push(frames);
    },
  });
  t.after(() => {
    timer.stop();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  return {
    timer,
    animationFrames,
    timeouts,
    displayedFrames,
    get frames() {
      return frames;
    },
    tick(time, flushTimeouts = true, currentTime = time) {
      now = currentTime;
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of callbacks) callback(time);
      if (flushTimeouts) {
        const pending = [...timeouts.values()];
        timeouts.clear();
        for (const callback of pending) callback();
      }
    },
  };
}

it("does not catch up time before playback when the first RAF timestamp is stale", (t) => {
  const clock = harness(t);
  clock.timer.start();
  clock.tick(850, true, 1000);
  clock.tick(1000);
  assert.equal(clock.frames, 0);
  assert.equal(clock.timeouts.size, 0);
  clock.tick(1000 + clock.timer.interval + 0.001);
  assert.equal(clock.frames, 1);
  assert.deepEqual(clock.displayedFrames, [1]);
});

it("does not fast-forward an unplayed startup delay before the first display callback", (t) => {
  const clock = harness(t);
  clock.timer.start();
  clock.tick(2000);
  assert.equal(clock.frames, 0);
  assert.equal(clock.timeouts.size, 0);
  clock.tick(2000 + clock.timer.interval + 0.001);
  assert.equal(clock.frames, 1);
});

it("displays audio-generated frames while display-driven emulation waits", (t) => {
  const clock = harness(t);
  clock.timer.start();
  clock.tick(1000);
  clock.timer.generateFrame();
  clock.timer.generateFrame();
  clock.tick(1000);
  assert.deepEqual(clock.displayedFrames, [2]);
  for (let tick = 1; tick <= 120; tick++) {
    if (tick % 4 === 0) {
      clock.timer.generateFrame();
      clock.timer.generateFrame();
    }
    clock.tick(1000 + (tick * 1000) / 120);
    assert.equal(clock.displayedFrames.at(-1), clock.frames);
  }
  assert.equal(clock.frames, 62, "Only the audio callback advances emulation");
  assert.equal(
    clock.displayedFrames.length,
    31,
    "Display each new buffer once",
  );
});

for (const refreshRate of [60, 120, 144, 240]) {
  for (const refill of [false, true]) {
    it(`keeps normal speed at ${refreshRate} Hz${refill ? " after an audio refill" : ""}`, (t) => {
      const clock = harness(t);
      clock.timer.start();
      clock.tick(1000);
      if (refill) {
        // Browser's audio-underrun callback generates exactly two frames.
        // At 120 Hz the old zero-only check ran 122 frames over this interval.
        clock.timer.generateFrame();
        clock.timer.generateFrame();
      }
      for (let tick = 1; tick <= refreshRate; tick++) {
        clock.tick(1000 + (tick * 1000) / refreshRate);
      }
      assert.equal(clock.frames, 60);
    });
  }
}

it("waits when repeated audio refills put the clock ahead", (t) => {
  const clock = harness(t);
  clock.timer.start();
  clock.tick(1000);
  for (let refill = 0; refill < 3; refill++) {
    clock.timer.generateFrame();
    clock.timer.generateFrame();
  }
  const afterRefills = clock.frames;
  for (let tick = 1; tick <= 10; tick++) clock.tick(1000 + tick * 8);
  assert.equal(clock.frames, afterRefills);
  clock.tick(1200);
  assert.ok(
    clock.frames > afterRefills,
    "Normal advancement resumes once wall time catches up",
  );
});

it("handles a refill before the first display timestamp without a catch-up burst", (t) => {
  const clock = harness(t);
  clock.timer.start();
  clock.timer.generateFrame();
  clock.timer.generateFrame();
  clock.tick(1000);
  assert.equal(clock.frames, 2);
  assert.equal(clock.timeouts.size, 0);
  clock.tick(1000 + clock.timer.interval + 0.001);
  assert.equal(clock.frames, 2);
  for (let tick = 2; tick <= 120; tick++) {
    clock.tick(1000 + (tick * 1000) / 120);
  }
  // Audio and display advancement share the clock established by start().
  assert.equal(clock.frames, 60);
});

it("does not count audio covering a delayed first display callback as ahead", (t) => {
  const clock = harness(t);
  clock.timer.start();
  for (let frame = 0; frame < 60; frame++) clock.timer.generateFrame();
  clock.tick(2000);
  assert.equal(clock.frames, 60);
  clock.tick(2000 + clock.timer.interval + 0.001);
  assert.equal(clock.frames, 61);
});
