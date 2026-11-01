import test from "node:test";
import assert from "node:assert/strict";
import { createSpeechPlayback } from "./textToSpeech.js";

function setup() {
  const states = [];
  const audios = [];
  const revoked = [];
  const calls = [];
  class Audio {
    constructor(url) { this.url = url; audios.push(this); }
    async play() { this.played = true; }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
  }
  const browser = {
    Audio,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: (url) => revoked.push(url) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, blob: async () => new Blob(["audio"], { type: "audio/mpeg" }) };
    },
  };
  const player = createSpeechPlayback(browser, (state) => states.push(state));
  return { player, browser, states, audios, calls, revoked };
}

test("requests generated audio for the reply and plays it at the chosen speed", async () => {
  const { player, states, audios, calls, revoked } = setup();
  await player.speak("reply", "नमस्ते", 1.25);
  assert.equal(calls[0].url, "/api/chat/speech");
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: "नमस्ते" });
  assert.equal(audios[0].playbackRate, 1.25);
  assert.equal(audios[0].played, true);
  assert.equal(states.at(-1).playingId, "reply");
  audios[0].onended();
  assert.deepEqual(states.at(-1), { playingId: null, error: "" });
  assert.deepEqual(revoked, ["blob:test"]);
});

test("switching or stopping cancels playback and ignores stale responses", async () => {
  const { player, browser, states, audios } = setup();
  let resolveFirst;
  browser.fetch = () => new Promise((resolve) => { resolveFirst = resolve; });
  const pending = player.speak("first", "First");
  player.stop();
  resolveFirst({ ok: true, blob: async () => new Blob(["audio"], { type: "audio/mpeg" }) });
  await pending;
  assert.equal(audios.length, 0);
  assert.deepEqual(states.at(-1), { playingId: null, error: "" });
});

test("provider errors and autoplay blocking leave a retryable state", async () => {
  const { player, browser, states } = setup();
  browser.fetch = async () => ({ ok: false, json: async () => ({ detail: "Free model is rate limited." }) });
  await player.speak("reply", "Hello");
  assert.match(states.at(-1).error, /rate limited/);
  const other = setup();
  other.browser.Audio.prototype.play = async () => { throw Object.assign(new Error("blocked"), { name: "NotAllowedError" }); };
  await other.player.speak("reply", "Hello");
  assert.match(other.states.at(-1).error, /blocked automatic audio/);
  assert.deepEqual(other.revoked, ["blob:test"]);
});

test("rejects invalid audio and supports browsers without audio playback", async () => {
  const { player, browser, states } = setup();
  browser.fetch = async () => ({ ok: true, blob: async () => new Blob(["error"], { type: "application/json" }) });
  await player.speak("reply", "Hello");
  assert.match(states.at(-1).error, /invalid speech audio/);
  assert.equal(createSpeechPlayback(null, () => {}).supported, false);
});

test("voice conversation continues only after a reply finishes naturally", async () => {
  const { player, audios } = setup();
  let completed = 0;
  await player.speak("reply", "Hello", 1, () => { completed += 1; });
  player.stop();
  assert.equal(completed, 0);
  await player.speak("next", "Hello again", 1, () => { completed += 1; });
  audios[1].onended();
  assert.equal(completed, 1);
});
