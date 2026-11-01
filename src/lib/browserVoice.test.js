import test from "node:test";
import assert from "node:assert/strict";
import {
  createBrowserRecognition,
  createBrowserSpeechPlayback,
} from "./browserVoice.js";

function recognitionSetup() {
  const instances = [];
  const states = [];
  const transcripts = [];
  const errors = [];
  class Recognition {
    constructor() {
      instances.push(this);
    }
    start() {
      this.onstart();
    }
    stop() {
      this.stopped = true;
    }
    abort() {
      this.aborted = true;
    }
  }
  const capture = createBrowserRecognition({
    browser: { webkitSpeechRecognition: Recognition },
    onState: (state) => states.push(state),
    onTranscript: (text) => transcripts.push(text),
    onError: () => errors.push(true),
  });
  return { capture, instances, states, transcripts, errors };
}

test("recognition submits one Hindi transcript after the user finishes", () => {
  const { capture, instances, transcripts, states } = recognitionSetup();
  capture.start("hi-IN");
  const recognition = instances[0];
  assert.equal(recognition.lang, "hi-IN");
  assert.equal(states.at(-1).status, "recording");
  recognition.onresult({ results: [[{ transcript: "मुझे मदद चाहिए" }]] });
  capture.finish();
  assert.equal(states.at(-1).status, "transcribing");
  recognition.onend();
  recognition.onend();
  assert.deepEqual(transcripts, ["मुझे मदद चाहिए"]);
  assert.equal(instances.length, 1);
});

test("cancelled or denied recognition never sends a transcript", () => {
  const { capture, instances, states, transcripts, errors } =
    recognitionSetup();
  capture.start();
  capture.cancel();
  instances[0].onresult({ results: [[{ transcript: "ignored" }]] });
  instances[0].onend();
  assert.deepEqual(transcripts, []);
  assert.equal(instances[0].aborted, true);
  capture.start();
  instances[1].onerror({ error: "not-allowed" });
  instances[1].onend();
  assert.match(states.at(-1).error, /denied/);
  assert.equal(errors.length, 1);
});

test("browser speech uses a matching voice and reports unavailable Hindi voices", () => {
  const states = [];
  const spoken = [];
  const voices = [{ lang: "en-IN" }, { lang: "hi-IN" }];
  const browser = {
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text;
      }
    },
    speechSynthesis: {
      getVoices: () => voices,
      speak: (utterance) => spoken.push(utterance),
      cancel() {},
    },
  };
  const player = createBrowserSpeechPlayback(browser, (state) =>
    states.push(state),
  );
  player.speak("a", "नमस्ते");
  assert.equal(spoken[0].voice.lang, "hi-IN");
  spoken[0].onend();
  assert.equal(states.at(-1).playingId, null);
  voices.pop();
  player.speak("b", "नमस्ते");
  assert.match(states.at(-1).error, /No Hindi voice/);
  assert.equal(spoken.length, 1);
});

 test("English speech prefers an Indian English voice", () => {
  const spoken = [];
  const browser = {
    SpeechSynthesisUtterance: class {},
    speechSynthesis: { getVoices: () => [{ lang: "en-US" }, { lang: "en-IN" }], speak: (utterance) => spoken.push(utterance), cancel() {} },
  };
  createBrowserSpeechPlayback(browser, () => {}).speak("a", "How are you?");
  assert.equal(spoken[0].voice.lang, "en-IN");
});
