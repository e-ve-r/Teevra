import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import useTextToSpeech from "../hooks/useTextToSpeech";
import useVoiceRecording from "../hooks/useVoiceRecording";

export default function Assistant({ active = true, remaining, report, trackingStarted, onReportUpdate }) {
  const speech = useTextToSpeech(active);
  const [speechRate, setSpeechRate] = useState(1);
  const [replyLanguage, setReplyLanguage] = useState("auto");
  const [speakReplies, setSpeakReplies] = useState(true);
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      from: "assistant",
      text: "Hi, I’m Teevra Assist. I can share basic first-aid steps while you wait for professional help, or help you use the app. For an emergency, call your local emergency service directly—this app cannot dispatch help. What happened?",
    },
  ]);
  const [shareUpdates, setShareUpdates] = useState(false);
  const [draft, setDraft] = useState("");
  const voice = useVoiceRecording(active, (text) => {
    setDraft((current) => [current.trim(), text].filter(Boolean).join(" "));
  });
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [failedMessages, setFailedMessages] = useState(null);
  const requestController = useRef(null);
  const messageList = useRef(null);
  const activeRef = useRef(active);
  const speechSettingsRef = useRef({ speakReplies, speechRate });
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { speechSettingsRef.current = { speakReplies, speechRate }; }, [speakReplies, speechRate]);
  useEffect(() => () => requestController.current?.abort(), []);
  useEffect(() => {
    if (messageList.current)
      messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [messages, typing]);

  async function requestReply(conversation) {
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 60000);
    setTyping(true);
    setError("");
    setFailedMessages(null);
    try {
      const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
      const response = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: conversation.filter((message) => message.id !== "welcome")
            .slice(-8)
            .map((message) => ({ role: message.from, content: message.text.slice(0, 2000) })),
          context: {
            remaining_seconds: remaining,
            tracking_started: Boolean(trackingStarted),
            has_report: Boolean(report),
            attachment_count: report?.attachments?.length || 0,
          },
          reply_language: replyLanguage,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.detail === "string"
          ? data.detail : "Chat is unavailable. Check that the backend is running.");
      }
      if (typeof data?.reply !== "string" || !data.reply.trim()) {
        throw new Error("The assistant returned an empty reply. Please try again.");
      }
      const reply = { id: crypto.randomUUID(), from: "assistant", text: data.reply };
      setMessages((current) => [
        ...current,
        reply,
      ]);
      if (speechSettingsRef.current.speakReplies && activeRef.current) {
        speech.speak(reply.id, reply.text, speechSettingsRef.current.speechRate);
      }
    } catch (failure) {
      setError(failure.name === "AbortError"
        ? "The request timed out. Please try again."
        : failure instanceof TypeError
          ? "Cannot connect to chat. Check that the backend is running."
          : failure.message);
      setFailedMessages(conversation);
    } finally {
      clearTimeout(timeout);
      requestController.current = null;
      setTyping(false);
    }
  }

  async function sendMessage(event, suggestion) {
    event?.preventDefault();
    const text = (suggestion || draft).trim();
    if (!text || typing) return;
    if (text.length > 2000) {
      setError("Your message is over 2,000 characters. Please shorten it before sending.");
      return;
    }
    const conversation = [
      ...messages,
      { id: crypto.randomUUID(), from: "user", text },
    ];
    if (onReportUpdate && shareUpdates) {
      setTyping(true);
      setError("");
      try {
        await onReportUpdate({ description: text });
      } catch (failure) {
        setError(`Your incident update was not saved: ${failure.message}`);
        setTyping(false);
        return;
      }
      setTyping(false);
    }
    setMessages(conversation);
    setDraft("");
    requestReply(conversation);
  }
  return (
    <section className="chat-surface surface">
      <div className="chat-heading">
        <span className="assistant-avatar">
          <Icon name="spark" size={24} />
        </span>
        <div>
          <h2>Teevra Assist</h2>
          <p>A little support, right here.</p>
        </div>
        <span className="small-badge">AI</span>
      </div>
      <div className="chat-speech-settings">
        <span>
          <Icon name="volume" size={17} />
          {speech.supported ? "Speak a message and listen to replies." : "Audio playback is not supported in this browser."}
        </span>
        <label>
          Reply language
          <select value={replyLanguage} onChange={(event) => setReplyLanguage(event.target.value)}>
            <option value="auto">Same as my message</option>
            {["English", "Hindi", "Spanish", "French", "Bengali", "Tamil", "Telugu", "Marathi"].map((language) => (
              <option key={language} value={language}>{language}</option>
            ))}
          </select>
        </label>
        {speech.supported && (
          <label>
            Reading speed
            <select
              value={speechRate}
              onChange={(event) => {
                speech.stop();
                setSpeechRate(Number(event.target.value));
              }}
            >
              <option value={0.75}>0.75×</option>
              <option value={1}>1×</option>
              <option value={1.25}>1.25×</option>
              <option value={1.5}>1.5×</option>
            </select>
          </label>
        )}
        {speech.supported && <label className="chat-auto-speech">
          <input type="checkbox" checked={speakReplies} onChange={(event) => {
            setSpeakReplies(event.target.checked);
            if (!event.target.checked) speech.stop();
          }} />
          Read new replies aloud
        </label>}
      </div>
      <div
        className="chat-messages"
        ref={messageList}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {messages.map((message) => (
          <div key={message.id} className={`chat-message ${message.from}`}>
            {message.from === "assistant" && (
              <span className="message-avatar">
                <Icon name="spark" size={17} />
              </span>
            )}
            <div>
              <div className="message-bubble">{message.text}</div>
              <span className="message-time">
                {message.from === "assistant" ? "Teevra Assist" : "You"}
              </span>
              {message.from === "assistant" && speech.supported && (
                <button
                  type="button"
                  className="message-read-aloud"
                  aria-label={speech.playingId === message.id ? "Stop reading this reply" : "Read this reply aloud"}
                  aria-pressed={speech.playingId === message.id}
                  onClick={() => speech.playingId === message.id
                    ? speech.stop()
                    : speech.speak(message.id, message.text, speechRate)}
                >
                  <Icon name={speech.playingId === message.id ? "stop" : "volume"} size={15} />
                  {speech.playingId === message.id ? "Stop" : "Read aloud"}
                </button>
              )}
            </div>
          </div>
        ))}
        {typing && (
          <div className="typing-indicator">
            Preparing a reply <span>•••</span>
          </div>
        )}
      </div>
      {(speech.error || voice.error) && <p className="chat-speech-error" role="alert">{speech.error || voice.error}</p>}
      {messages.length === 1 && (
        <div className="chat-suggestions">
          <span>YOU CAN ASK</span>
          {["When will help arrive?", "How do I add a photo?"].map((text) => (
            <button key={text} onClick={() => sendMessage(null, text)}>
              {text}
              <Icon name="arrow" size={17} />
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="chat-error" role="alert">
          <p>{error}</p>
          {failedMessages && <button type="button" disabled={typing} onClick={() => failedMessages && requestReply(failedMessages)}>
            Retry
          </button>}
        </div>
      )}
      {onReportUpdate && <label className="chat-share-update"><input type="checkbox" checked={shareUpdates} onChange={(e) => setShareUpdates(e.target.checked)} />Share my messages as updates to report {report.id}</label>}
      <div className="chat-recording">
        <button
          type="button"
          className={`chat-record-button ${voice.status === "recording" ? "is-recording" : ""}`}
          disabled={!voice.supported || typing || ["starting", "transcribing"].includes(voice.status)}
          onClick={voice.status === "recording" ? voice.stop : voice.start}
        >
          <Icon name={voice.status === "recording" ? "stop" : "mic"} size={17} />
          {voice.status === "recording" ? "Stop recording" : voice.status === "starting" ? "Starting microphone…" : voice.status === "transcribing" ? "Transcribing…" : "Speak your message"}
        </button>
        <span>{voice.supported ? "Up to 30 seconds. Review the transcript before sending." : "Voice input is unavailable in this browser."}</span>
      </div>
      <form className="chat-composer" onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="chat-input">
          Message Teevra Assist
        </label>
        <input
          id="chat-input"
          placeholder="Type your message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          autoComplete="off"
        />
        <button aria-label="Send message" disabled={!draft.trim() || typing || voice.status !== "idle"}>
          <Icon name="send" size={21} />
        </button>
      </form>
      <p className="chat-disclaimer">
        AI can make mistakes. Not an emergency service. Recordings and spoken replies are sent to Google Gemini; chat messages go to OpenRouter and its providers.
      </p>
    </section>
  );
}
