import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import useTextToSpeech from "../hooks/useTextToSpeech";
import useVoiceRecording from "../hooks/useVoiceRecording";
import ReportReview from "./ReportReview";
import { mediaUrl, uploadAttachments } from "../lib/api";
import { compressImage } from "../lib/compressImage";
import { loadChatHistory, saveChatHistory } from "../lib/chatHistory";

export default function Assistant({ active = true, report, incidentId, reporterName, reporterPhone, onSubmitReport, onTrack }) {
  const [messages, setMessages] = useState(() => loadChatHistory(localStorage));
  const messagesRef = useRef(messages);
  const [storageError, setStorageError] = useState("");
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [failedMessages, setFailedMessages] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [recommended, setRecommended] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState(() => navigator.language?.toLowerCase().startsWith("hi") ? "hi-IN" : "en-IN");
  const voiceModeRef = useRef(false);
  const activeRef = useRef(active);
  const busyRef = useRef(false);
  const requestController = useRef(null);
  const requestGeneration = useRef(0);
  const messageList = useRef(null);
  const imageInput = useRef(null);
  const speech = useTextToSpeech(active);
  const voice = useVoiceRecording(active, (text) => {
    voiceModeRef.current = false;
    setVoiceMode(false);
    void sendTurn(text, null, true);
  }, () => {
    voiceModeRef.current = false;
    setVoiceMode(false);
  }, voiceLanguage);
  const reportImages = messages.flatMap((message) => message.attachments || []);
  const mayCreateReport = !incidentId || (report && ["resolved", "cancelled"].includes(report.status));

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    if (!active) return;
    return () => { voiceModeRef.current = false; setVoiceMode(false); };
  }, [active]);
  useEffect(() => () => requestController.current?.abort(), []);
  useEffect(() => { if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight; }, [messages, typing]);

  function commitMessages(next) {
    messagesRef.current = next;
    setMessages(next);
    setStorageError(saveChatHistory(localStorage, next) ? "" : "Chat could not be saved on this device. Keep this page open to retain the conversation.");
  }

  async function requestReply(conversation) {
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 125000);
    setTyping(true);
    setError("");
    setFailedMessages(null);
    try {
      const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
      const response = await fetch(`${apiBase}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          messages: conversation.map((message) => ({ role: message.from, content: message.text,
            ...(message.attachments?.length ? { attachments: message.attachments } : {}) })),
          context: { incident_id: incidentId || null }, reply_language: "auto",
        }),
      });
      const data = await response.json().catch(() => null);
      if (generation !== requestGeneration.current) return;
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : response.status === 422 ? "This conversation has reached its size limit. Start a new report to continue." : "Chat is unavailable. Please try again.");
      if (typeof data?.reply !== "string" || !data.reply.trim()) throw new Error("The assistant returned an empty reply. Please try again.");
      const reply = { id: crypto.randomUUID(), from: "assistant", text: data.reply.replace(/\*\*/g, "") };
      commitMessages([...messagesRef.current, reply]);
      if (data.recommend_report) setRecommended(true);
      if (activeRef.current && speech.supported) {
        speech.speak(reply.id, reply.text);
      } else if (activeRef.current && !speech.supported) {
        setError("Spoken replies are unavailable in this browser. You can read the reply above.");
      }
    } catch (failure) {
      if (generation !== requestGeneration.current) return;
      voiceModeRef.current = false;
      setVoiceMode(false);
      setError(failure.name === "AbortError" ? "The request timed out. Please try again." : failure instanceof TypeError ? "Cannot connect to chat. Please try again." : failure.message);
      setFailedMessages(conversation);
    } finally {
      clearTimeout(timeout);
      if (generation === requestGeneration.current) {
        requestController.current = null;
        busyRef.current = false;
        setTyping(false);
      }
    }
  }

  async function sendTurn(rawText, attachedImage = image, fromVoice = false) {
    const text = rawText.trim();
    if ((!text && !attachedImage) || busyRef.current || preparingImage) return;
    if (text.length > 2000) { setError("Please keep messages under 2,000 characters."); return; }
    busyRef.current = true;
    speech.stop();
    const message = { id: crypto.randomUUID(), from: "user", text: text || "Please help me report what is shown in this image.",
      imageOnly: !text, attachments: attachedImage ? [attachedImage] : [] };
    const conversation = [...messagesRef.current, message];
    commitMessages(conversation);
    if (!fromVoice) { setDraft(""); setImage(null); }
    await requestReply(conversation);
  }

  async function chooseImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreparingImage(true);
    setError("");
    try {
      const compressed = await compressImage(file);
      const [uploaded] = await uploadAttachments([{ file: compressed, name: compressed.name }]);
      setImage(uploaded);
    } catch (failure) { setError(failure.message || "Could not prepare the image."); }
    finally { setPreparingImage(false); }
  }

  function endVoice() {
    voiceModeRef.current = false;
    setVoiceMode(false);
    voice.stop();
    speech.stop();
  }

  function toggleVoice() {
    if (voiceModeRef.current) {
      if (voice.status === "recording") voice.finish();
      return;
    }
    if (!voice.supported) {
      setError("Speech recognition is unavailable in this browser. Try Chrome or type your message.");
      return;
    }
    setError("");
    voiceModeRef.current = true;
    setVoiceMode(true);
    speech.stop();
    voice.start();
  }

  return <div className="conversation">
    <div className="conversation-log" ref={messageList} role="log" aria-label="Conversation" aria-live="polite">
      {!messages.length && <div className="conversation-empty"><span className="conversation-spark"><Icon name="spark" size={26} /></span><h1>What happened?</h1><p>Tell me what’s going on.</p></div>}
      {messages.map((message) => <div key={message.id} className={`conversation-message ${message.from}`}>
        <div className="conversation-bubble">
          {message.attachments?.map((attachment) => <img key={attachment.id} className="conversation-image" src={mediaUrl(attachment.url)} alt={attachment.name || "Uploaded image"} />)}
          {!message.imageOnly && <div>{message.text}</div>}
          {message.from === "assistant" && speech.supported && <button type="button" className="conversation-audio" onClick={() => speech.playingId === message.id ? speech.stop() : speech.speak(message.id, message.text)} aria-label={speech.playingId === message.id ? "Stop audio" : "Play reply"}>
            <Icon name={speech.playingId === message.id ? "stop" : "volume"} size={16} />
          </button>}
        </div>
      </div>)}
      {typing && <div className="conversation-thinking" role="status">Thinking<span>•••</span></div>}
    </div>
    {(error || speech.error || voice.error || storageError) && <div className="conversation-error" role="alert">{error || speech.error || voice.error || storageError}
      {failedMessages && <button type="button" disabled={typing} onClick={() => { busyRef.current = true; requestReply(failedMessages); }}>Retry</button>}
    </div>}
    {voiceMode && <div className="conversation-voice-status" role="status">
      <span>{voice.status === "recording" ? "Listening… tap the checkmark to send" : voice.status === "starting" ? "Starting microphone…" : voice.status === "transcribing" ? "Transcribing…" : typing ? "Thinking…" : speech.playingId ? "Speaking…" : "Voice chat on"}</span>
      <button type="button" onClick={endVoice}>End voice</button>
    </div>}
    {image && <div className="conversation-preview"><img src={mediaUrl(image.url)} alt="Selected image" /><button type="button" onClick={() => setImage(null)} aria-label="Remove selected image"><Icon name="cross" size={16} /></button></div>}
    <form className="conversation-compose" onSubmit={(event) => { event.preventDefault(); void sendTurn(draft); }}>
      <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={chooseImage} aria-label="Choose an image" />
      <button type="button" className="conversation-icon" onClick={() => imageInput.current?.click()} aria-label="Add image" disabled={preparingImage || typing || voiceMode}><Icon name="plus" size={23} /></button>
      <label className="sr-only" htmlFor="chat-input">Message Teevra</label>
      <input id="chat-input" placeholder={preparingImage ? "Preparing image…" : "Describe what happened…"} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} autoComplete="off" disabled={voiceMode} />
      {!draft.trim() && !image && !voiceMode && <button type="button" className="conversation-voice-language" onClick={() => setVoiceLanguage((value) => value === "en-IN" ? "hi-IN" : "en-IN")} aria-label={`Speech input language: ${voiceLanguage === "en-IN" ? "English" : "Hindi"}. Change language.`}>{voiceLanguage === "en-IN" ? "EN" : "हिं"}</button>}
      {draft.trim() || image ? <button type="submit" className="conversation-send" aria-label="Send message" disabled={typing || preparingImage || voiceMode}><Icon name="send" size={20} /></button>
        : <button type="button" className={`conversation-mic ${voiceMode ? "active" : ""}`} onClick={toggleVoice} disabled={(typing && !voiceMode) || preparingImage || (voiceMode && voice.status !== "recording")} aria-label={voiceMode ? "Send voice message" : "Start voice chat"}><Icon name={voiceMode ? "check" : "mic"} size={20} /></button>}
    </form>
    <div className="conversation-action">
      {incidentId ? <button type="button" className="conversation-primary tracking" onClick={onTrack}><Icon name="pin" size={19} />Live tracking</button>
        : <button type="button" className="conversation-primary" disabled={!messages.some((message) => message.from === "user") || !mayCreateReport} onClick={() => {
          endVoice();
          setReviewOpen(true);
        }}>
          <Icon name="siren" size={19} />{recommended ? "Review report" : "Report"}</button>}
    </div>
    {reviewOpen && mayCreateReport && <div className="report-modal" role="dialog" aria-modal="true" aria-label="Review report">
      <ReportReview conversation={messages} attachmentCount={reportImages.length} name={reporterName} phone={reporterPhone} onCancel={() => setReviewOpen(false)}
        onSubmit={async (details) => {
          const created = await onSubmitReport({ ...details, attachments: reportImages });
          requestGeneration.current += 1;
          requestController.current?.abort();
          requestController.current = null;
          busyRef.current = false;
          setTyping(false);
          setError("");
          setFailedMessages(null);
          setReviewOpen(false);
          const confirmation = { id: crypto.randomUUID(), from: "assistant", text: `Report ${created.id} was sent to the response workspace. You can follow its status in Live tracking.` };
          commitMessages([...messagesRef.current, confirmation]);
        }} />
    </div>}
  </div>;
}
