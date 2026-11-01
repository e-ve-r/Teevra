import { useEffect, useRef, useState } from "react";
import { recordingToWav } from "../lib/recording";

export default function useVoiceRecording(active, onTranscript) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const session = useRef(null);
  const supported = typeof window !== "undefined" && Boolean(
    navigator.mediaDevices?.getUserMedia && window.MediaRecorder
    && (window.AudioContext || window.webkitAudioContext)
    && (window.OfflineAudioContext || window.webkitOfflineAudioContext),
  );

  useEffect(() => {
    if (!active) return;
    const cancel = () => {
      const current = session.current;
      session.current = null;
      if (!current) return;
      clearTimeout(current.timer);
      current.controller.abort();
      if (current.recorder?.state !== "inactive") current.recorder?.stop();
      current.stream?.getTracks().forEach((track) => track.stop());
      setStatus("idle");
    };
    const onVisibilityChange = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", cancel);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", cancel);
      cancel();
    };
  }, [active]);

  async function start() {
    if (!active || !supported || session.current) return;
    const current = { controller: new AbortController() };
    session.current = current;
    setError("");
    setStatus("starting");
    try {
      current.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session.current !== current) {
        current.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const chunks = [];
      current.recorder = new MediaRecorder(current.stream);
      current.recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      current.recorder.onerror = () => {
        if (session.current !== current) return;
        session.current = null;
        clearTimeout(current.timer);
        current.stream.getTracks().forEach((track) => track.stop());
        setStatus("idle");
        setError("Recording failed. Please try again.");
      };
      current.recorder.onstop = async () => {
        clearTimeout(current.timer);
        current.stream.getTracks().forEach((track) => track.stop());
        if (session.current !== current) return;
        setStatus("transcribing");
        try {
          const wav = await recordingToWav(new Blob(chunks, { type: current.recorder.mimeType }));
          if (session.current !== current) return;
          const form = new FormData();
          form.append("audio", wav, "recording.wav");
          const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
          const response = await fetch(`${apiBase}/api/chat/transcribe`, {
            method: "POST", body: form, signal: current.controller.signal,
          });
          const body = await response.json().catch(() => null);
          if (!response.ok || typeof body?.text !== "string" || !body.text.trim()) {
            throw new Error(typeof body?.detail === "string" ? body.detail : "Could not transcribe the recording. Try again.");
          }
          if (session.current === current) onTranscript(body.text.trim());
        } catch (failure) {
          if (session.current === current) setError(failure.message || "Could not transcribe the recording. Try again.");
        } finally {
          if (session.current === current) {
            session.current = null;
            setStatus("idle");
          }
        }
      };
      current.recorder.start();
      current.timer = setTimeout(() => {
        if (current.recorder.state === "recording") current.recorder.stop();
      }, 30000);
      setStatus("recording");
    } catch (failure) {
      current.stream?.getTracks().forEach((track) => track.stop());
      if (session.current !== current) return;
      session.current = null;
      setStatus("idle");
      setError(failure.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser or type your message."
        : "Could not start the microphone. Please try again or type your message.");
    }
  }

  function stop() {
    const current = session.current;
    if (current?.recorder?.state === "recording") current.recorder.stop();
  }

  return { supported, status, error, start, stop };
}
