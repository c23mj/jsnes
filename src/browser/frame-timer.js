// Debug logging, enabled via localStorage.jsnes_debug = 1
let debugEnabled = false;
try {
  debugEnabled = !!localStorage.getItem("jsnes_debug");
} catch {
  // localStorage not available
}

const FPS = 60.098;

export default class FrameTimer {
  constructor(props) {
    // Run at 60 FPS
    this.onGenerateFrame = props.onGenerateFrame;
    // Run on animation frame
    this.onWriteFrame = props.onWriteFrame;
    this.onAnimationFrame = this.onAnimationFrame.bind(this);
    this.running = true;
    this.interval = 1e3 / FPS;
    this.lastFrameTime = false;
    this.hasUndisplayedFrame = false;
  }

  start() {
    this.running = true;
    // RAF timestamps can predate this call. Begin playback at the current time
    // so the timer never catches up time from before playback started.
    const now = window.performance.now();
    this.lastFrameTime = now - (now % this.interval);
    this._requestID = window.requestAnimationFrame((time) => {
      // A delayed first display must not fast-forward unplayed startup time.
      // Keep any lead from audio frames that have already been generated.
      const now = window.performance.now();
      this.lastFrameTime = Math.max(
        this.lastFrameTime,
        now - (now % this.interval),
      );
      this.onAnimationFrame(time);
    });
  }

  stop() {
    this.running = false;
    if (this._requestID) window.cancelAnimationFrame(this._requestID);
    this.lastFrameTime = false;
    this.hasUndisplayedFrame = false;
  }

  requestAnimationFrame() {
    this._requestID = window.requestAnimationFrame(this.onAnimationFrame);
  }

  generateFrame() {
    this.onGenerateFrame();
    this.lastFrameTime += this.interval;
    this.hasUndisplayedFrame = true;
  }

  onAnimationFrame = (time) => {
    this.requestAnimationFrame();
    // how many ms after 60fps frame time
    let excess = time % this.interval;

    // newFrameTime is the current time aligned to 60fps intervals.
    // i.e. 16.6, 33.3, etc ...
    let newFrameTime = time - excess;

    let numFrames = Math.round(
      (newFrameTime - this.lastFrameTime) / this.interval,
    );

    // Audio refill may already have advanced emulation ahead of wall time.
    if (numFrames > 0) this.generateFrame();
    // Display new frames regardless of whether audio or this callback made them.
    if (this.hasUndisplayedFrame) {
      this.hasUndisplayedFrame = false;
      this.onWriteFrame();
    }
    if (numFrames <= 1) return;

    // we generate additional frames evenly before the next
    // onAnimationFrame call.
    // additional frames are generated but not displayed
    // until next frame draw
    let timeToNextFrame = this.interval - excess;
    for (let i = 1; i < numFrames; i++) {
      setTimeout(
        () => {
          this.generateFrame();
        },
        (i * timeToNextFrame) / numFrames,
      );
    }
    if (numFrames > 1 && debugEnabled) {
      console.log("SKIP", numFrames - 1, this.lastFrameTime);
    }
  };
}
