import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceCapture } from "./voiceCapture.js";

function setup({ deny = false, meterFails = false, fetchResult } = {}) {
  const states = [];
  const transcripts = [];
  const errors = [];
  const requests = [];
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks };
  const recorders = [];
  class MediaRecorder {
    constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; recorders.push(this); }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  }
  class AudioContext {
    constructor() { if (meterFails) throw new Error("meter unavailable"); }
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData() {} }; }
    createMediaStreamSource() { return { connect() {} }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  const browser = {
    navigator: { mediaDevices: { getUserMedia: async () => {
      if (deny) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      return stream;
    } } },
    MediaRecorder, AudioContext, OfflineAudioContext: class {},
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      return fetchResult || { ok: true, json: async () => ({ text: "  नमस्ते  " }) };
    },
  };
  const capture = createVoiceCapture({ browser, apiBase: "https://example.test", toWav: async (blob) => {
    assert.equal(await blob.text(), "recorded audio");
    return new Blob(["wav"], { type: "audio/wav" });
  }, onState: (state) => states.push(state), onTranscript: (text) => transcripts.push(text), onError: () => errors.push(true) });
  return { capture, browser, states, transcripts, errors, requests, tracks, recorders };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("finishing a spoken turn sends the captured audio and displays the transcript", async () => {
  const { capture, states, transcripts, requests, tracks } = setup();
  await capture.start();
  assert.equal(states.at(-1).status, "recording");
  assert.equal(capture.finish(), true);
  assert.equal(states.at(-1).status, "transcribing");
  await flush();
  assert.deepEqual(transcripts, ["नमस्ते"]);
  assert.equal(requests[0].url, "https://example.test/api/chat/transcribe");
  assert.equal(requests[0].options.body.get("audio").type, "audio/wav");
  assert.equal(tracks[0].stopped, true);
  assert.equal(states.at(-1).status, "idle");
});

test("ending voice chat discards the recording instead of submitting it", async () => {
  const { capture, transcripts, requests, tracks } = setup();
  await capture.start();
  capture.cancel();
  await flush();
  assert.deepEqual(transcripts, []);
  assert.equal(requests.length, 0);
  assert.equal(tracks[0].stopped, true);
});

test("manual finish still works when automatic silence detection is unavailable", async () => {
  const { capture, transcripts } = setup({ meterFails: true });
  await capture.start();
  capture.finish();
  await flush();
  assert.deepEqual(transcripts, ["नमस्ते"]);
});

test("a quiet spoken turn is sent after a pause", async () => {
  const { capture, browser, transcripts, states } = setup();
  let frame;
  let clock = 100;
  let level = 0.012;
  browser.performance.now = () => clock;
  browser.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  browser.AudioContext.prototype.createAnalyser = () => ({
    fftSize: 0,
    getFloatTimeDomainData: (values) => values.fill(level),
  });
  await capture.start();
  frame();
  level = 0;
  clock += 1500;
  frame();
  await flush();
  assert.deepEqual(transcripts, ["नमस्ते"]);
  assert.equal(states.at(-1).status, "idle");
});

test("a silent recording times out without requesting transcription", async () => {
  const { capture, browser, requests, states, tracks } = setup();
  let timeout;
  browser.setTimeout = (callback) => { timeout = callback; return 1; };
  await capture.start();
  timeout();
  await flush();
  assert.equal(requests.length, 0);
  assert.match(states.at(-1).error, /No speech detected/);
  assert.equal(tracks[0].stopped, true);
});

test("permission and transcription errors stop the session and explain the problem", async () => {
  const denied = setup({ deny: true });
  await denied.capture.start();
  assert.match(denied.states.at(-1).error, /denied/);
  assert.equal(denied.errors.length, 1);
  const unavailable = setup({ fetchResult: { ok: false, json: async () => ({ detail: "Voice service unavailable." }) } });
  await unavailable.capture.start();
  unavailable.capture.finish();
  await flush();
  assert.equal(unavailable.states.at(-1).error, "Voice service unavailable.");
  assert.equal(unavailable.errors.length, 1);
});

test("cancelling while microphone permission is pending stops a late stream", async () => {
  let resolvePermission;
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const browser = {
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolvePermission = resolve; }) } },
    MediaRecorder: class {}, AudioContext: class {}, OfflineAudioContext: class {},
    clearTimeout() {}, cancelAnimationFrame() {},
  };
  const capture = createVoiceCapture({ browser, onState() {}, onTranscript() {} });
  const pending = capture.start();
  capture.cancel();
  resolvePermission({ getTracks: () => tracks });
  await pending;
  assert.equal(tracks[0].stopped, true);
});
