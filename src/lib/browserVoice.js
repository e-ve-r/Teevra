export function supportsBrowserRecognition(browser) {
  return Boolean(browser?.SpeechRecognition || browser?.webkitSpeechRecognition);
}

export function createBrowserRecognition({ browser, onState, onTranscript, onError }) {
  const supported = supportsBrowserRecognition(browser);
  let current = null;

  function cancel() {
    const session = current;
    current = null;
    if (session) { try { session.recognition.abort(); } catch { /* Already stopped. */ } }
    onState({ status: "idle", error: "" });
  }

  function finish() {
    if (!current || current.finishing) return false;
    current.finishing = true;
    onState({ status: "transcribing", error: "" });
    try { current.recognition.stop(); } catch { cancel(); onError?.(); return false; }
    return true;
  }

  function start(language = "en-IN") {
    if (!supported || current) return;
    const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    const recognition = new Recognition();
    const session = { recognition, transcript: "", finishing: false };
    current = session;
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => { if (current === session) onState({ status: "recording", error: "" }); };
    recognition.onresult = (event) => {
      if (current !== session) return;
      session.transcript = Array.from(event.results, (result) => result[0]?.transcript || "").join(" ").trim();
    };
    recognition.onerror = (event) => {
      if (current !== session) return;
      current = null;
      const message = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone or speech recognition access was denied. Check browser permissions."
        : event.error === "no-speech" ? "No speech detected. Tap the microphone to try again."
          : event.error === "network" ? "Browser speech recognition needs a network connection."
            : "Browser speech recognition failed. Try again or type your message.";
      onState({ status: "idle", error: message });
      onError?.();
    };
    recognition.onend = () => {
      if (current !== session) return;
      current = null;
      if (session.transcript) {
        onState({ status: "idle", error: "" });
        onTranscript(session.transcript);
      } else {
        onState({ status: "idle", error: "No speech detected. Tap the microphone to try again." });
        onError?.();
      }
    };
    onState({ status: "starting", error: "" });
    try { recognition.start(); } catch {
      current = null;
      onState({ status: "idle", error: "Could not start browser speech recognition. Try again." });
      onError?.();
    }
  }
  return { supported, start, finish, cancel };
}

export function createBrowserSpeechPlayback(browser, onChange) {
  const supported = Boolean(browser?.speechSynthesis && browser?.SpeechSynthesisUtterance);
  let current = null;

  function stop() {
    const previous = current;
    current = null;
    if (previous) browser.speechSynthesis.cancel();
    onChange({ playingId: null, error: "" });
  }

  function speak(id, text, rate = 1, onComplete, onFailure) {
    stop();
    if (!supported || !text.trim()) return;
    const language = /[\u0900-\u097f]/.test(text) ? "hi" : "en";
    const voices = browser.speechSynthesis.getVoices();
    const candidates = voices.filter((voice) => voice.lang?.toLowerCase().split("-")[0] === language);
    if (voices.length && !candidates.length) {
      onChange({ playingId: null, error: `No ${language === "hi" ? "Hindi" : "English"} voice is available on this device.` });
      onFailure?.();
      return;
    }
    const utterance = new browser.SpeechSynthesisUtterance(text);
    utterance.lang = `${language}-IN`;
    utterance.rate = rate;
    if (candidates.length) utterance.voice = candidates.find((voice) => voice.lang.toLowerCase() === `${language}-in`) || candidates[0];
    current = utterance;
    utterance.onend = () => {
      if (current !== utterance) return;
      current = null;
      onChange({ playingId: null, error: "" });
      onComplete?.();
    };
    utterance.onerror = () => {
      if (current !== utterance) return;
      current = null;
      onChange({ playingId: null, error: "Could not play the reply. Tap the speaker icon to try again." });
      onFailure?.();
    };
    onChange({ playingId: id, error: "" });
    try { browser.speechSynthesis.speak(utterance); } catch { utterance.onerror(); }
  }

  return { supported, speak, stop };
}
