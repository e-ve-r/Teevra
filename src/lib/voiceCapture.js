// Own one microphone session at a time. Finishing submits audio; cancelling discards it.
export function supportsVoiceCapture(browser) {
  return Boolean(browser?.navigator?.mediaDevices?.getUserMedia && browser?.MediaRecorder
    && (browser.AudioContext || browser.webkitAudioContext)
    && (browser.OfflineAudioContext || browser.webkitOfflineAudioContext));
}

export function createVoiceCapture({ browser, toWav, apiBase = "", onState, onTranscript, onError }) {
  const supported = supportsVoiceCapture(browser);
  let current = null;

  function releaseMeter(session) {
    if (session.frame != null) browser.cancelAnimationFrame(session.frame);
    session.frame = null;
    if (session.meterContext) {
      const closing = session.meterContext.close();
      closing?.catch?.(() => {});
      session.meterContext = null;
    }
  }

  function finish() {
    if (current?.recorder?.state !== "recording") return false;
    onState({ status: "transcribing", error: "" });
    current.recorder.stop();
    return true;
  }

  function cancel() {
    const session = current;
    current = null;
    if (session) {
      browser.clearTimeout(session.timer);
      releaseMeter(session);
      session.controller.abort();
      if (session.recorder?.state === "recording") session.recorder.stop();
      session.stream?.getTracks().forEach((track) => track.stop());
    }
    onState({ status: "idle", error: "" });
  }

  function failed(session, message) {
    if (current !== session) return;
    current = null;
    browser.clearTimeout(session.timer);
    releaseMeter(session);
    session.stream?.getTracks().forEach((track) => track.stop());
    onState({ status: "idle", error: message });
    onError?.();
  }

  async function start() {
    if (!supported || current) return;
    const session = { controller: new AbortController(), frame: null };
    current = session;
    onState({ status: "starting", error: "" });
    try {
      session.stream = await browser.navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== session) {
        session.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const chunks = [];
      session.recorder = new browser.MediaRecorder(session.stream);
      session.recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      session.recorder.onerror = () => failed(session, "Recording failed. Please try again.");
      session.recorder.onstop = async () => {
        browser.clearTimeout(session.timer);
        releaseMeter(session);
        session.stream.getTracks().forEach((track) => track.stop());
        if (current !== session) return;
        onState({ status: "transcribing", error: "" });
        try {
          if (!chunks.length) throw new Error("No audio was recorded. Please try again.");
          const wav = await toWav(new Blob(chunks, { type: session.recorder.mimeType }));
          if (current !== session) return;
          const form = new FormData();
          form.append("audio", wav, "recording.wav");
          let response;
          try {
            response = await browser.fetch(`${apiBase}/api/chat/transcribe`, {
              method: "POST", body: form, signal: session.controller.signal,
            });
          } catch (failure) {
            if (failure.name === "AbortError") throw failure;
            throw new Error("Cannot reach the voice service. Check the connection and that the backend is running.", { cause: failure });
          }
          const body = await response.json().catch(() => null);
          if (!response.ok || typeof body?.text !== "string" || !body.text.trim()) {
            throw new Error(typeof body?.detail === "string" ? body.detail : "Transcription is unavailable. Check that the backend is running and try again.");
          }
          if (current !== session) return;
          current = null;
          onState({ status: "idle", error: "" });
          onTranscript(body.text.trim());
        } catch (failure) {
          failed(session, failure.name === "AbortError" ? "Recording cancelled." : failure.message || "Could not transcribe the recording. Try again.");
        }
      };
      session.recorder.start();
      onState({ status: "recording", error: "" });

      // Silence detection is optional: a user can always finish the recording manually.
      let meterActive = false;
      let speechStarted = false;
      try {
        const Context = browser.AudioContext || browser.webkitAudioContext;
        session.meterContext = new Context();
        const analyser = session.meterContext.createAnalyser();
        analyser.fftSize = 1024;
        session.meterContext.createMediaStreamSource(session.stream).connect(analyser);
        session.meterContext.resume().catch(() => {});
        const samples = new Float32Array(analyser.fftSize);
        let lastVoice = 0;
        meterActive = true;
        const listen = () => {
          if (current !== session || session.recorder.state !== "recording") return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          if (rms > 0.008) { lastVoice = browser.performance.now(); speechStarted = true; }
          if (speechStarted && browser.performance.now() - lastVoice > 1400) {
            finish();
            return;
          }
          session.frame = browser.requestAnimationFrame(listen);
        };
        session.frame = browser.requestAnimationFrame(listen);
      } catch {
        releaseMeter(session);
      }
      session.timer = browser.setTimeout(() => {
        if (current !== session) return;
        if (!meterActive || speechStarted) finish();
        else {
          failed(session, "No speech detected. Tap the microphone to try again.");
          if (session.recorder.state === "recording") session.recorder.stop();
        }
      }, 30000);
    } catch (failure) {
      if (session.recorder?.state === "recording") session.recorder.stop();
      failed(session, failure.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser and try again."
        : "Could not start the microphone. Check your browser permissions and try again.");
    }
  }

  return { supported, start, finish, cancel };
}
