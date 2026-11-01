// Playback uses server-generated audio; the API key stays on the server.
export function createSpeechPlayback(browser, onChange, apiBase = "") {
  const supported = Boolean(
    browser?.Audio && browser?.fetch && browser?.URL?.createObjectURL,
  );
  let current = null;

  function stop() {
    const previous = current;
    current = null;
    if (previous) {
      previous.controller.abort();
      if (previous.audio) {
        previous.audio.pause();
        previous.audio.onended = null;
        previous.audio.onerror = null;
        previous.audio.removeAttribute("src");
        previous.audio.load();
      }
      if (previous.url) browser.URL.revokeObjectURL(previous.url);
    }
    onChange({ playingId: null, error: "" });
  }

  async function speak(id, text, rate = 1, onComplete, onFailure) {
    stop();
    if (!supported || !text.trim()) return;
    const next = { controller: new AbortController() };
    current = next;
    onChange({ playingId: id, error: "" });
    try {
      const response = await browser.fetch(`${apiBase}/api/chat/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: next.controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail || "Speech generation is unavailable. Try again.",
        );
      }
      const blob = await response.blob();
      if (current !== next) return;
      if (!blob.size || !blob.type.toLowerCase().startsWith("audio/")) {
        throw new Error("The server returned invalid speech audio. Try again.");
      }
      next.url = browser.URL.createObjectURL(blob);
      next.audio = new browser.Audio(next.url);
      next.audio.playbackRate = rate;
      next.audio.onended = () => {
        if (current === next) {
          stop();
          onComplete?.();
        }
      };
      next.audio.onerror = () => {
        if (current !== next) return;
        stop();
        onChange({
          playingId: null,
          error: "Could not play this reply. Try again.",
        });
        onFailure?.();
      };
      await next.audio.play();
    } catch (error) {
      if (current !== next) return;
      stop();
      onChange({
        playingId: null,
        error:
          error.name === "NotAllowedError"
            ? "Your browser blocked automatic audio. Select the speaker icon to play the reply."
            : error.message || "Speech generation failed. Try again.",
      });
      onFailure?.();
    }
  }

  return { supported, speak, stop };
}
