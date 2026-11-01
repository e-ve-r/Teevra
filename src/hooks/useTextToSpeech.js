import { useEffect, useState } from "react";
import { createSpeechPlayback } from "../lib/textToSpeech";

export default function useTextToSpeech(active = true) {
  const [playback, setPlayback] = useState({ playingId: null, error: "" });
  const [player] = useState(() =>
    createSpeechPlayback(
      typeof window === "undefined" ? null : window,
      setPlayback,
      (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, ""),
    ),
  );

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

  return {
    ...playback,
    supported: player.supported,
    stop: player.stop,
    speak: (id, text, rate, onComplete, onFailure) => {
      if (active) return player.speak(id, text, rate, onComplete, onFailure);
    },
  };
}
