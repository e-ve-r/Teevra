import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export default function Assistant({ remaining, report, trackingStarted }) {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      from: "assistant",
      text: "Hi, I’m Teevra Assist. I can share basic first-aid steps while you wait for professional help, or help you use the app. For an emergency, call your local emergency service directly—this app cannot dispatch help. What happened?",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [failedMessages, setFailedMessages] = useState(null);
  const requestController = useRef(null);
  const messageList = useRef(null);
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
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), from: "assistant", text: data.reply },
      ]);
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

  function sendMessage(event, suggestion) {
    event?.preventDefault();
    const text = (suggestion || draft).trim();
    if (!text || typing) return;
    const conversation = [
      ...messages,
      { id: crypto.randomUUID(), from: "user", text },
    ];
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
            </div>
          </div>
        ))}
        {typing && (
          <div className="typing-indicator">
            Preparing a reply <span>•••</span>
          </div>
        )}
      </div>
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
          <button type="button" disabled={typing} onClick={() => requestReply(failedMessages)}>
            Retry
          </button>
        </div>
      )}
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
        <button aria-label="Send message" disabled={!draft.trim() || typing}>
          <Icon name="send" size={21} />
        </button>
      </form>
      <p className="chat-disclaimer">
        AI can make mistakes. Not an emergency service. Messages are sent to OpenRouter and its inference provider.
      </p>
    </section>
  );
}
