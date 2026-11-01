import { useEffect, useState } from "react";
import { createSpeechPlayback } from "../lib/textToSpeech";
import { createBrowserSpeechPlayback } from "../lib/browserVoice";

export default function useTextToSpeech(active = true) {
  const [playback, setPlayback] = useState({ playingId: null, error: "" });
  const [player] = useState(() => import.meta.env.VITE_VOICE_PROVIDER === "gemini"
    ? createSpeechPlayback(typeof window === "undefined" ? null : window, setPlayback,
      (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, ""))
    : createBrowserSpeechPlayback(typeof window === "undefined" ? null : window, setPlayback));

  useEffect(() => {
    if (!active || !player.supported) return;
    const onVisibilityChange = () => {
      if (document.hidden) player.stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", player.stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", player.stop);
      player.stop();
    };
  }, [active, player]);

  return { ...playback, supported: player.supported, stop: player.stop,
    speak: (id, text, rate, onComplete, onFailure) => { if (active) return player.speak(id, text, rate, onComplete, onFailure); } };
}
