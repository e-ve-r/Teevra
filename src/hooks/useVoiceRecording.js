import { useEffect, useRef, useState } from "react";
import { recordingToWav } from "../lib/recording";
import { createVoiceCapture, supportsVoiceCapture } from "../lib/voiceCapture";
import { createBrowserRecognition, supportsBrowserRecognition } from "../lib/browserVoice";

export default function useVoiceRecording(active, onTranscript, onError, language = "en-IN") {
  const [state, setState] = useState({ status: "idle", error: "" });
  const callbacks = useRef({ onTranscript, onError });
  const capture = useRef(null);
  useEffect(() => { callbacks.current = { onTranscript, onError }; }, [onTranscript, onError]);
  const browser = typeof window === "undefined" ? null : window;
  const useGemini = import.meta.env.VITE_VOICE_PROVIDER === "gemini";
  const supported = useGemini ? supportsVoiceCapture(browser) : supportsBrowserRecognition(browser);

  function getCapture() {
    if (!capture.current) capture.current = (useGemini ? createVoiceCapture : createBrowserRecognition)({
      browser: window,
      toWav: recordingToWav,
      apiBase: (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, ""),
      onState: setState,
      onTranscript: (text) => callbacks.current.onTranscript(text),
      onError: () => callbacks.current.onError?.(),
    });
    return capture.current;
  }

  useEffect(() => {
    if (!active) return;
    const onVisibilityChange = () => {
      if (document.hidden) { capture.current?.cancel(); callbacks.current.onError?.(); }
    };
    const onPageHide = () => { capture.current?.cancel(); callbacks.current.onError?.(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      capture.current?.cancel();
    };
  }, [active]);

  return { ...state, supported,
    start: () => { if (active && supported) return getCapture().start(language); },
    finish: () => capture.current?.finish(),
    stop: () => capture.current?.cancel() };
}
